import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { campaignResults, createDb, mailingLetters, pieces, users, workspaces, type Database } from '@maas/db';
import { runMigrations } from '../../db/src/migrate';
import { createCampaign, createPiece, savePrintPiece, setPieceStatus } from '../src/campaigns';
import { addressLines, createMailing, deleteMailing, listMailings, parseRecipients, runMailingCycle } from '../src/mailings';
import { letterOutcome, PingenClient, pingenConfig } from '../src/pingen';

type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };

/** A stand-in for Pingen's API that records what it was asked. */
function fakePingen(options: { failCreate?: (call: number) => number | undefined; letterStatus?: () => string } = {}) {
  const calls: Call[] = [];
  let creates = 0;
  let letters = 0;
  const fetcher = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([key, value]) => [key.toLowerCase(), value]));
    const body = typeof init.body === 'string' ? (headers['content-type']?.includes('json') ? JSON.parse(init.body) : init.body) : init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : init.body ? '(file)' : undefined;
    calls.push({ method, url, headers, body });
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    const path = url.replace(/^https:\/\/api(-staging)?\.pingen\.com/, '');
    if (path === '/auth/access-tokens') return json(200, { token_type: 'Bearer', expires_in: 43200, access_token: 'tok' });
    if (headers.authorization && headers.authorization !== 'Bearer tok') return json(401, { errors: [{ title: 'Unauthenticated' }] });
    if (path === '/organisations') return json(200, { data: [{ id: 'org1', type: 'organisations', attributes: {} }] });
    if (path === '/file-upload') return json(200, { data: { id: 'u', type: 'file_uploads', attributes: { url: 'https://s3.example/upload?sig', url_signature: 'sig' } } });
    if (url.startsWith('https://s3.example/')) return new Response(null, { status: 200 });
    if (path === '/organisations/org1/deliveries/letters' && method === 'POST') {
      const status = options.failCreate?.(++creates);
      if (status) return json(status, { errors: [{ detail: status === 422 ? 'The address could not be read.' : 'Try again later.' }] });
      return json(201, { data: { id: `letter${++letters}`, type: 'letters', attributes: { status: 'validating', price_value: 1.2, price_currency: 'EUR' } } });
    }
    const letter = /^\/organisations\/org1\/deliveries\/letters\/(\w+)$/.exec(path);
    if (letter) return json(200, { data: { id: letter[1], type: 'letters', attributes: { status: options.letterStatus?.() ?? 'sent', price_value: 1.2, price_currency: 'EUR' } } });
    if (path === '/organisations/org1/deliveries/letters/price-calculator') return json(200, { data: { id: 'p', type: 'letter_price_calculator', attributes: { price: 1.2, currency: 'EUR' } } });
    return json(404, { errors: [{ title: `Not found: ${method} ${path}` }] });
  }) as typeof fetch;
  return { calls, client: new PingenClient({ clientId: 'id', clientSecret: 'secret', staging: false }, fetcher) };
}

describe('recipients', () => {
  it('reads lists pasted from spreadsheets', () => {
    const { recipients, problems } = parseRecipients(
      ['Name;Straße;PLZ;Ort;Land', 'Erika Mustermann; Musterweg 12; 12345; Musterstadt', '"Max Muster"\tBahnhofstr. 1\t8001\tZürich\tch', '', 'Ohne Adresse;;;', 'Jo, Weg 1, 1010, Wien, Österreich'].join('\n'),
    );
    expect(recipients).toEqual([
      { name: 'Erika Mustermann', street: 'Musterweg 12', postcode: '12345', city: 'Musterstadt', country: 'DE' },
      { name: 'Max Muster', street: 'Bahnhofstr. 1', postcode: '8001', city: 'Zürich', country: 'CH' },
    ]);
    expect(problems).toEqual([
      { line: 5, problem: 'missing' },
      { line: 6, problem: 'country' },
    ]);
  });

  it('writes the country in capitals under the address', () => {
    expect(addressLines({ name: 'Max', street: 'Bahnhofstr. 1', postcode: '8001', city: 'Zürich', country: 'CH' })).toEqual(['Bahnhofstr. 1', '8001 Zürich', 'SCHWEIZ']);
  });
});

describe('Pingen client', () => {
  it('is set up from the environment', () => {
    expect(pingenConfig({})).toBeNull();
    expect(pingenConfig({ PINGEN_CLIENT_ID: 'a', PINGEN_CLIENT_SECRET: 'b', PINGEN_STAGING: 'true' })).toMatchObject({ clientId: 'a', staging: true });
  });

  it('uploads a letter and sends it once per key', async () => {
    const { calls, client } = fakePingen();
    const letter = await client.sendLetter(new Uint8Array([1, 2, 3]), { fileName: 'brief.pdf', deliveryProduct: 'cheap', color: false, key: 'maas-letter-1' });
    expect(letter).toEqual({ id: 'letter1', status: 'validating', priceValue: 1.2, priceCurrency: 'EUR' });
    expect(calls.map((call) => `${call.method} ${call.url.replace('https://api.pingen.com', '')}`)).toEqual([
      'POST /auth/access-tokens',
      'GET /organisations',
      'GET /file-upload',
      'PUT https://s3.example/upload?sig',
      'POST /organisations/org1/deliveries/letters',
    ]);
    expect(calls[0]!.body).toMatchObject({ grant_type: 'client_credentials', client_id: 'id', client_secret: 'secret' });
    const create = calls.at(-1)!;
    expect(create.headers['idempotency-key']).toBe('maas-letter-1');
    expect(create.body).toEqual({
      data: {
        type: 'letters',
        attributes: {
          file_original_name: 'brief.pdf',
          file_url: 'https://s3.example/upload?sig',
          file_url_signature: 'sig',
          address_position: 'left',
          auto_send: true,
          delivery_product: 'cheap',
          print_mode: 'simplex',
          print_spectrum: 'grayscale',
        },
      },
    });
    // The token is reused.
    await client.getLetter('letter1');
    expect(calls.filter((call) => call.url.endsWith('/auth/access-tokens'))).toHaveLength(1);
  });

  it('knows which Pingen states are final', () => {
    expect(letterOutcome('sent')).toBe('sent');
    expect(letterOutcome('action_required')).toBe('failed');
    expect(letterOutcome('validating')).toBe('underway');
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('mailings (Postgres)', () => {
  let db: Database;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    await runMigrations(url);
    db = createDb(url);
  });
  afterAll(async () => db?.close());
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE workspaces, users CASCADE`);
    const [user] = await db.insert(users).values({ email: 'a@example.com', name: 'A', passwordHash: 'x' }).returning();
    const [workspace] = await db.insert(workspaces).values({ name: 'Praxis' }).returning();
    userId = user!.id;
    workspaceId = workspace!.id;
  });

  async function approvedLetter() {
    const campaign = await createCampaign(db, workspaceId, userId, {
      name: 'Rückenwochen',
      goal: 'leads',
      status: 'running',
      audience: '',
      message: '',
      startsOn: null,
      endsOn: null,
      currency: 'EUR',
      budgetCents: 0,
      channels: [],
      notes: '',
    });
    const piece = await createPiece(db, workspaceId, campaign.id, { kind: 'print', format: 'letter_a4', title: 'Brief an Bestandskunden' });
    await savePrintPiece(db, workspaceId, piece.id, {
      title: piece.title,
      content: { headline: 'Hallo {name}', body: 'Kommen Sie vorbei.', callToAction: '', qrUrl: '', showCharacter: false, showLogo: true, showContact: true },
    });
    return { campaign, piece };
  }
  const people = [
    { name: 'Erika Mustermann', street: 'Musterweg 12', postcode: '12345', city: 'Musterstadt', country: 'DE' },
    { name: 'Max Muster', street: 'Bahnhofstr. 1', postcode: '8001', city: 'Zürich', country: 'CH' },
  ];

  it('sends only approved letters', async () => {
    const { piece } = await approvedLetter();
    await expect(createMailing(db, workspaceId, userId, piece.id, people, { deliveryProduct: 'fast', color: true })).rejects.toThrow(/Approve the piece first/);
  });

  it('hands letters to Pingen, follows them and books the cost', async () => {
    const { campaign, piece } = await approvedLetter();
    await setPieceStatus(db, workspaceId, piece.id, 'approved', userId);
    const mailing = await createMailing(db, workspaceId, userId, piece.id, people, { deliveryProduct: 'fast', color: true });
    expect((await db.query.pieces.findFirst({ where: eq(pieces.id, piece.id) }))?.status).toBe('live');

    const { calls, client } = fakePingen({ letterStatus: () => 'sent' });
    expect(await runMailingCycle(db, client)).toMatchObject({ sent: 2 });
    const pdfUploads = calls.filter((call) => call.method === 'PUT');
    expect(pdfUploads).toHaveLength(2);
    const letters = await db.select().from(mailingLetters).where(eq(mailingLetters.mailingId, mailing.id));
    expect(letters.map((letter) => [letter.status, letter.serviceStatus, letter.priceCents]).sort()).toEqual([
      ['submitted', 'validating', 120],
      ['submitted', 'validating', 120],
    ]);
    // Booked as a campaign result once everything is handed over.
    const [result] = await db.select().from(campaignResults).where(eq(campaignResults.campaignId, campaign.id));
    expect(result).toMatchObject({ channel: 'mail', reach: 2, spendCents: 240, source: 'pingen' });

    // Later, Pingen reports them sent.
    await runMailingCycle(db, client, { now: () => new Date(Date.now() + 60 * 60_000) });
    const [summary] = await listMailings(db, workspaceId, piece.id);
    expect(summary).toMatchObject({ letters: 2, sent: 2, failed: 0, status: 'done', cost: { cents: 240, currency: 'EUR' } });
    expect(await db.select().from(campaignResults)).toHaveLength(1);
  });

  it('retries what Pingen could not take right now and stops at what it refuses', async () => {
    const { piece } = await approvedLetter();
    await setPieceStatus(db, workspaceId, piece.id, 'approved', userId);
    await createMailing(db, workspaceId, userId, piece.id, people, { deliveryProduct: 'fast', color: true });
    const { client } = fakePingen({ failCreate: (call) => (call === 1 ? 503 : call === 2 ? 422 : undefined) });
    await runMailingCycle(db, client);
    const statuses = async () => (await db.select().from(mailingLetters).orderBy(mailingLetters.createdAt)).map((letter) => [letter.status, letter.error]);
    const first = await statuses();
    expect(first).toContainEqual(['queued', 'Pingen: creating the letter failed: Try again later.']);
    expect(first).toContainEqual(['failed', 'Pingen: creating the letter failed: The address could not be read.']);
    // The retry waits a little, then goes through.
    await db.execute(sql`UPDATE mailing_letters SET updated_at = now() - interval '1 hour' WHERE status = 'queued'`);
    await runMailingCycle(db, client);
    expect((await statuses()).map(([status]) => status).sort()).toEqual(['failed', 'submitted']);
    const [summary] = await listMailings(db, workspaceId, piece.id);
    expect(summary).toMatchObject({ failed: 1, problems: [{ name: expect.any(String), error: expect.stringContaining('could not be read') }] });
  });

  it('deletes a mailing with its addresses, only in its workspace', async () => {
    const { piece } = await approvedLetter();
    await setPieceStatus(db, workspaceId, piece.id, 'approved', userId);
    const mailing = await createMailing(db, workspaceId, userId, piece.id, people, { deliveryProduct: 'fast', color: true });
    const [other] = await db.insert(workspaces).values({ name: 'Other' }).returning();
    expect(await deleteMailing(db, other!.id, mailing.id)).toBe(false);
    expect(await listMailings(db, other!.id, piece.id)).toEqual([]);
    expect(await deleteMailing(db, workspaceId, mailing.id)).toBe(true);
    expect(await db.select().from(mailingLetters)).toEqual([]);
  });
});
