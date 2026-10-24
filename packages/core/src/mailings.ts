/**
 * Mailings: an approved letter piece, personalized and sent by post to a
 * list of recipients through Pingen. People queue a mailing; the worker
 * renders each letter, hands it to Pingen and follows it until it is sent,
 * then books the cost as a campaign result.
 */
import { and, asc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { campaignResults, campaigns, mailingLetters, mailings, pieces, type Database, type Mailing, type MailingLetter, type Piece } from '@maas/db';
import { CampaignError } from './campaigns';
import { letterOutcome, PingenClient, PingenError, pingenConfig, type DeliveryProduct } from './pingen';
import { renderPiece, type Recipient } from './print';

/** Letters per mailing (more go in another mailing). */
export const MAX_RECIPIENTS = 1000;
const MAX_ATTEMPTS = 3;
/** How long a letter may stay "uploading" before another worker tries again. */
const STUCK_MS = 15 * 60_000;
/** How often to ask Pingen about a letter on its way. */
const CHECK_EVERY_MS = 30 * 60_000;

export interface MailingRecipient {
  name: string;
  street: string;
  postcode: string;
  city: string;
  /** ISO 3166 code ("DE"). */
  country: string;
}

export type RecipientProblem = { line: number; problem: 'missing' | 'country' };

const COUNTRY = /^[A-Z]{2}$/;

/**
 * Reads recipients pasted from a spreadsheet: one per line, columns separated
 * by semicolons, tabs or commas: name, street, postcode, town, country
 * (optional, default DE). A header line is skipped.
 */
export function parseRecipients(text: string, defaultCountry = 'DE'): { recipients: MailingRecipient[]; problems: RecipientProblem[] } {
  const recipients: MailingRecipient[] = [];
  const problems: RecipientProblem[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, index) => {
    if (!raw.trim()) return;
    const separator = raw.includes('\t') ? '\t' : raw.includes(';') ? ';' : ',';
    const cells = raw.split(separator).map((cell) => cell.trim().replace(/^"(.*)"$/, '$1').trim());
    if (index === 0 && /^(name|empfänger|recipient)$/i.test(cells[0] ?? '')) return;
    const [name = '', street = '', postcode = '', city = '', country = ''] = cells;
    if (!name || !street || !postcode || !city) {
      problems.push({ line: index + 1, problem: 'missing' });
      return;
    }
    const code = (country || defaultCountry).toUpperCase();
    if (!COUNTRY.test(code)) {
      problems.push({ line: index + 1, problem: 'country' });
      return;
    }
    recipients.push({ name: name.slice(0, 120), street: street.slice(0, 120), postcode: postcode.slice(0, 20), city: city.slice(0, 80), country: code });
  });
  return { recipients, problems };
}

/** The address lines under the name; the country in capitals, as post offices want it. */
export function addressLines(recipient: MailingRecipient, locale = 'de'): string[] {
  let country = recipient.country;
  try {
    country = new Intl.DisplayNames([locale], { type: 'region' }).of(recipient.country) ?? recipient.country;
  } catch {
    // unknown code: print it as is
  }
  return [recipient.street, `${recipient.postcode} ${recipient.city}`, country.toLocaleUpperCase(locale)];
}

export interface MailingOptions {
  deliveryProduct: DeliveryProduct;
  color: boolean;
}

/** The letter service, when the server admin set one up. */
export function mailingService(env: Record<string, string | undefined> = process.env, fetcher?: typeof fetch): PingenClient | null {
  const config = pingenConfig(env);
  return config ? new PingenClient(config, fetcher) : null;
}

/** What a mailing would cost: Pingen's price per country, times the letters going there. */
export async function estimateMailing(client: PingenClient, recipients: MailingRecipient[], options: MailingOptions): Promise<{ total: number; currency: string }> {
  const perCountry = new Map<string, number>();
  for (const recipient of recipients) perCountry.set(recipient.country, (perCountry.get(recipient.country) ?? 0) + 1);
  let total = 0;
  let currency = '';
  for (const [country, count] of perCountry) {
    const price = await client.price(country, options);
    total += price.value * count;
    currency = price.currency;
  }
  return { total: Math.round(total * 100) / 100, currency };
}

/** Whether a piece can go out by post: an approved (or live) A4 letter. */
export const isMailable = (piece: Pick<Piece, 'kind' | 'format' | 'status'>) => piece.kind === 'print' && piece.format === 'letter_a4' && (piece.status === 'approved' || piece.status === 'live');

/** Queues a mailing; the worker sends it. The piece counts as live from now on. */
export async function createMailing(db: Database, workspaceId: string, userId: string, pieceId: string, recipients: MailingRecipient[], options: MailingOptions, locale = 'de'): Promise<Mailing> {
  const piece = await db.query.pieces.findFirst({ where: and(eq(pieces.id, pieceId), eq(pieces.workspaceId, workspaceId)) });
  if (!piece) throw new CampaignError((m) => m.pieceNotFound);
  if (!isMailable(piece)) throw new CampaignError((m) => m.approveFirst);
  if (recipients.length === 0 || recipients.length > MAX_RECIPIENTS) throw new CampaignError((m) => m.recipients(MAX_RECIPIENTS));
  return db.transaction(async (tx) => {
    const [mailing] = await tx
      .insert(mailings)
      .values({ workspaceId, campaignId: piece.campaignId, pieceId, deliveryProduct: options.deliveryProduct, color: options.color, locale, createdBy: userId })
      .returning();
    await tx.insert(mailingLetters).values(
      recipients.map((recipient) => ({ mailingId: mailing!.id, workspaceId, name: recipient.name, lines: addressLines(recipient, locale), country: recipient.country })),
    );
    if (piece.status === 'approved') await tx.update(pieces).set({ status: 'live', updatedAt: new Date() }).where(eq(pieces.id, pieceId));
    return mailing!;
  });
}

export interface MailingSummary extends Mailing {
  letters: number;
  queued: number;
  submitted: number;
  sent: number;
  failed: number;
  /** Sum of the known prices, per currency. */
  cost: { cents: number; currency: string } | null;
  problems: { name: string; error: string }[];
}

/** A piece's mailings, the latest first, with where their letters stand. */
export async function listMailings(db: Database, workspaceId: string, pieceId: string): Promise<MailingSummary[]> {
  const rows = await db.query.mailings.findMany({
    where: and(eq(mailings.workspaceId, workspaceId), eq(mailings.pieceId, pieceId)),
    with: { letters: true },
    orderBy: (m, { desc }) => [desc(m.createdAt)],
  });
  return rows.map(({ letters, ...mailing }) => {
    const count = (...statuses: MailingLetter['status'][]) => letters.filter((letter) => statuses.includes(letter.status)).length;
    const priced = letters.filter((letter) => letter.priceCents !== null && letter.status !== 'failed');
    return {
      ...mailing,
      letters: letters.length,
      queued: count('queued', 'uploading'),
      submitted: count('submitted'),
      sent: count('sent'),
      failed: count('failed'),
      cost: priced.length ? { cents: priced.reduce((sum, letter) => sum + letter.priceCents!, 0), currency: priced[0]!.priceCurrency ?? '' } : null,
      problems: letters.filter((letter) => letter.status === 'failed').slice(0, 20).map((letter) => ({ name: letter.name, error: letter.error ?? '' })),
    };
  });
}

/** Deletes a mailing and the addresses it kept (letters already handed over still go out). */
export async function deleteMailing(db: Database, workspaceId: string, mailingId: string): Promise<boolean> {
  const deleted = await db.delete(mailings).where(and(eq(mailings.id, mailingId), eq(mailings.workspaceId, workspaceId))).returning({ id: mailings.id });
  return deleted.length > 0;
}

// ------------------------------------------------------------------ worker

const errorText = (error: unknown) => (error instanceof PingenError ? error.message : error instanceof Error ? error.message : String(error));

/** Takes up to `limit` queued letters (skipping ones other workers hold, and ones waiting to retry). */
async function claimQueued(db: Database, limit: number) {
  const now = Date.now();
  // Letters stuck while uploading (a worker stopped) go back to the queue; the idempotency key prevents duplicates.
  await db
    .update(mailingLetters)
    .set({ status: 'queued', updatedAt: new Date() })
    .where(and(eq(mailingLetters.status, 'uploading'), lt(mailingLetters.updatedAt, new Date(now - STUCK_MS))));
  return db.execute<{ id: string }>(sql`
    UPDATE ${mailingLetters} SET status = 'uploading', updated_at = now(), attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM ${mailingLetters}
      WHERE status = 'queued' AND updated_at < now() - (attempts * interval '2 minutes')
      ORDER BY created_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `);
}

/** Books a finished mailing (every letter handed over or failed) as a campaign result. */
async function finishMailings(db: Database, now: Date) {
  const open = await db.query.mailings.findMany({ where: eq(mailings.status, 'sending'), with: { letters: true } });
  for (const mailing of open) {
    if (mailing.letters.some((letter) => letter.status === 'queued' || letter.status === 'uploading')) continue;
    const delivered = mailing.letters.filter((letter) => letter.status !== 'failed');
    const campaign = await db.query.campaigns.findFirst({ where: eq(campaigns.id, mailing.campaignId) });
    const piece = await db.query.pieces.findFirst({ where: eq(pieces.id, mailing.pieceId) });
    const spendCents = delivered.filter((letter) => letter.priceCurrency === campaign?.currency).reduce((sum, letter) => sum + (letter.priceCents ?? 0), 0);
    await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(mailings)
        .set({ status: 'done', finishedAt: now })
        .where(and(eq(mailings.id, mailing.id), eq(mailings.status, 'sending')))
        .returning({ id: mailings.id });
      if (!claimed || delivered.length === 0) return;
      await tx.insert(campaignResults).values({
        workspaceId: mailing.workspaceId,
        campaignId: mailing.campaignId,
        channel: 'mail',
        day: now.toISOString().slice(0, 10),
        reach: delivered.length,
        spendCents,
        note: `${piece?.title ?? 'Mailing'} (${delivered.length})`,
        source: 'pingen',
      });
    });
  }
}

/**
 * One round of the worker: sends queued letters, follows letters on their
 * way and books finished mailings. Does nothing without a letter service.
 */
export async function runMailingCycle(db: Database, client: PingenClient | null = mailingService(), options: { batch?: number; now?: () => Date } = {}): Promise<{ sent: number; checked: number }> {
  if (!client) return { sent: 0, checked: 0 };
  const now = options.now ?? (() => new Date());
  const claimed = await claimQueued(db, options.batch ?? 10);
  let sent = 0;
  const pieceCache = new Map<string, { piece: Piece; mailing: Mailing }>();
  for (const { id } of claimed) {
    const letter = await db.query.mailingLetters.findFirst({ where: eq(mailingLetters.id, id) });
    if (!letter) continue;
    try {
      let entry = pieceCache.get(letter.mailingId);
      if (!entry) {
        const mailing = await db.query.mailings.findFirst({ where: eq(mailings.id, letter.mailingId) });
        const piece = mailing && (await db.query.pieces.findFirst({ where: eq(pieces.id, mailing.pieceId) }));
        if (!mailing || !piece) throw new Error('The letter piece no longer exists.');
        entry = { piece, mailing };
        pieceCache.set(letter.mailingId, entry);
      }
      const recipient: Recipient = { name: letter.name, lines: letter.lines };
      const { pdf } = await renderPiece(db, entry.piece, { recipient, locale: entry.mailing.locale, date: now() });
      const result = await client.sendLetter(pdf, {
        fileName: `${entry.piece.title.replace(/[^\w\- ]+/g, '').slice(0, 60) || 'letter'}.pdf`,
        deliveryProduct: entry.mailing.deliveryProduct as DeliveryProduct,
        color: entry.mailing.color,
        key: `maas-letter-${letter.id}`,
      });
      await db
        .update(mailingLetters)
        .set({
          status: letterOutcome(result.status) === 'failed' ? 'failed' : 'submitted',
          serviceId: result.id,
          serviceStatus: result.status,
          priceCents: result.priceValue === null ? null : Math.round(result.priceValue * 100),
          priceCurrency: result.priceCurrency,
          error: letterOutcome(result.status) === 'failed' ? `Pingen: ${result.status}` : null,
          updatedAt: now(),
        })
        .where(eq(mailingLetters.id, id));
      sent++;
    } catch (error) {
      const retry = error instanceof PingenError && error.retryable && letter.attempts < MAX_ATTEMPTS;
      await db
        .update(mailingLetters)
        .set({ status: retry ? 'queued' : 'failed', error: errorText(error).slice(0, 500), updatedAt: now() })
        .where(eq(mailingLetters.id, id));
    }
  }

  // Follow letters on their way.
  const due = await db
    .select()
    .from(mailingLetters)
    .where(and(eq(mailingLetters.status, 'submitted'), or(lt(mailingLetters.updatedAt, new Date(now().getTime() - CHECK_EVERY_MS)), sql`${mailingLetters.priceCents} IS NULL`)))
    .orderBy(asc(mailingLetters.updatedAt))
    .limit(25);
  let checked = 0;
  for (const letter of due) {
    if (!letter.serviceId) continue;
    try {
      const state = await client.getLetter(letter.serviceId);
      const outcome = letterOutcome(state.status);
      await db
        .update(mailingLetters)
        .set({
          status: outcome === 'underway' ? 'submitted' : outcome,
          serviceStatus: state.status,
          ...(state.priceValue !== null && { priceCents: Math.round(state.priceValue * 100), priceCurrency: state.priceCurrency }),
          error: outcome === 'failed' ? `Pingen: ${state.status}` : null,
          updatedAt: now(),
        })
        .where(eq(mailingLetters.id, letter.id));
      checked++;
    } catch (error) {
      // Try again next time; note what went wrong.
      await db.update(mailingLetters).set({ error: errorText(error).slice(0, 500), updatedAt: now() }).where(eq(mailingLetters.id, letter.id));
    }
  }

  await finishMailings(db, now());
  return { sent, checked };
}

/** Letters still waiting for the worker, per mailing (for the "sending…" display). */
export async function pendingLetters(db: Database, mailingIds: string[]): Promise<Map<string, number>> {
  if (mailingIds.length === 0) return new Map();
  const rows = await db
    .select({ mailingId: mailingLetters.mailingId, n: sql<number>`count(*)::int` })
    .from(mailingLetters)
    .where(and(inArray(mailingLetters.mailingId, mailingIds), inArray(mailingLetters.status, ['queued', 'uploading'])))
    .groupBy(mailingLetters.mailingId);
  return new Map(rows.map((row) => [row.mailingId, row.n]));
}
