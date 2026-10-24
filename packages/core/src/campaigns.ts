import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { campaignResults, campaigns, pieces, posts, type Campaign, type CampaignResult, type ChannelBudget, type Database, type Piece } from '@maas/db';
import { LocalizedError } from './i18n';
import { findMedia } from './media';
import {
  CAMPAIGN_STATUSES,
  CHANNELS,
  CURRENCIES,
  emptyContent,
  GOALS,
  isPieceFormat,
  PIECE_KINDS,
  PIECE_STATUSES,
  pieceChannel,
  type CampaignStatus,
  type Channel,
  type Goal,
  type PieceKind,
  type PieceStatus,
  type PrintContent,
} from './marketing';
import { campaignMessages } from './messages';

/** Something about a campaign the user has to fix; the message is meant for the user. */
export class CampaignError extends LocalizedError {
  constructor(pick: (m: (typeof campaignMessages)['en']) => string) {
    super((locale) => pick(campaignMessages[locale]));
  }
}

export interface CampaignInput {
  name: string;
  goal: Goal;
  status: CampaignStatus;
  audience: string;
  message: string;
  /** "YYYY-MM-DD" or null. */
  startsOn: string | null;
  endsOn: string | null;
  currency: string;
  budgetCents: number;
  channels: ChannelBudget[];
  notes: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function day(value: string | null): string | null {
  if (!value?.trim()) return null;
  const text = value.trim();
  if (!DAY.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) throw new CampaignError((m) => m.date);
  return text;
}

function longText(value: string, max: number): string {
  const text = value.trim();
  if (text.length > max) throw new CampaignError((m) => m.textTooLong(max));
  return text;
}

/** Amounts and counts are stored as 32-bit integers. */
const MAX_NUMBER = 2_000_000_000;
const isCount = (value: number) => Number.isInteger(value) && value >= 0 && value <= MAX_NUMBER;

const amount = (cents: number) => {
  if (!isCount(cents)) throw new CampaignError((m) => m.budget);
  return cents;
};

/** Checks and cleans a campaign; throws CampaignError with what to fix. */
export function cleanCampaign(input: CampaignInput): CampaignInput {
  const name = input.name.trim();
  if (!name) throw new CampaignError((m) => m.name);
  if (name.length > 120) throw new CampaignError((m) => m.nameTooLong);
  const startsOn = day(input.startsOn);
  const endsOn = day(input.endsOn);
  if (startsOn && endsOn && endsOn < startsOn) throw new CampaignError((m) => m.endBeforeStart);
  if (!(CURRENCIES as readonly string[]).includes(input.currency)) throw new CampaignError((m) => m.currency);
  const seen = new Set<string>();
  const channels: ChannelBudget[] = [];
  for (const entry of input.channels) {
    if (!(CHANNELS as readonly string[]).includes(entry.channel)) throw new CampaignError((m) => m.channel);
    if (seen.has(entry.channel)) continue;
    seen.add(entry.channel);
    channels.push({ channel: entry.channel, budgetCents: amount(entry.budgetCents) });
  }
  return {
    name,
    goal: (GOALS as readonly string[]).includes(input.goal) ? input.goal : 'awareness',
    status: (CAMPAIGN_STATUSES as readonly string[]).includes(input.status) ? input.status : 'draft',
    audience: longText(input.audience, 1000),
    message: longText(input.message, 500),
    startsOn,
    endsOn,
    currency: input.currency,
    budgetCents: amount(input.budgetCents),
    channels: channels.sort((a, b) => CHANNELS.indexOf(a.channel as Channel) - CHANNELS.indexOf(b.channel as Channel)),
    notes: longText(input.notes, 4000),
  };
}

export async function createCampaign(db: Database, workspaceId: string, userId: string, input: CampaignInput): Promise<Campaign> {
  const [row] = await db
    .insert(campaigns)
    .values({ workspaceId, createdBy: userId, ...cleanCampaign(input) })
    .returning();
  return row!;
}

export async function updateCampaign(db: Database, workspaceId: string, campaignId: string, input: CampaignInput): Promise<Campaign> {
  const [row] = await db
    .update(campaigns)
    .set({ ...cleanCampaign(input), updatedAt: new Date() })
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.workspaceId, workspaceId)))
    .returning();
  if (!row) throw new CampaignError((m) => m.notFound);
  return row;
}

/** Deletes a campaign with its pieces and results; its posts stay, without the campaign. */
export async function deleteCampaign(db: Database, workspaceId: string, campaignId: string): Promise<Campaign | undefined> {
  const [row] = await db
    .delete(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.workspaceId, workspaceId)))
    .returning();
  return row;
}

export interface CampaignListItem extends Campaign {
  pieceCount: number;
  postCount: number;
  spendCents: number;
}

/** A workspace's campaigns, the latest first, with their counts and spend so far. */
export async function listCampaigns(db: Database, workspaceId: string): Promise<CampaignListItem[]> {
  const rows = await db
    .select({
      campaign: campaigns,
      // Written out: Drizzle leaves columns unqualified inside sql``, which is ambiguous in a subquery.
      pieceCount: sql<number>`(select count(*)::int from pieces pc where pc.campaign_id = campaigns.id)`,
      postCount: sql<number>`(select count(*)::int from posts p where p.campaign_id = campaigns.id)`,
      spendCents: sql<number>`(select coalesce(sum(r.spend_cents), 0)::bigint from campaign_results r where r.campaign_id = campaigns.id)`.mapWith(Number),
    })
    .from(campaigns)
    .where(eq(campaigns.workspaceId, workspaceId))
    .orderBy(desc(sql`coalesce(${campaigns.startsOn}, ${campaigns.createdAt}::date)`), desc(campaigns.createdAt));
  return rows.map(({ campaign, ...counts }) => ({ ...campaign, ...counts }));
}

export interface CampaignDetail {
  campaign: Campaign;
  pieces: Piece[];
  posts: { id: string; text: string; status: string; scheduledAt: Date | null }[];
  results: CampaignResult[];
}

export async function getCampaign(db: Database, workspaceId: string, campaignId: string): Promise<CampaignDetail | null> {
  const campaign = await db.query.campaigns.findFirst({ where: and(eq(campaigns.id, campaignId), eq(campaigns.workspaceId, workspaceId)) });
  if (!campaign) return null;
  const [pieceRows, postRows, results] = await Promise.all([
    db.select().from(pieces).where(eq(pieces.campaignId, campaignId)).orderBy(asc(pieces.createdAt)),
    db
      .select({ id: posts.id, text: posts.text, status: posts.status, scheduledAt: posts.scheduledAt })
      .from(posts)
      .where(and(eq(posts.campaignId, campaignId), eq(posts.workspaceId, workspaceId)))
      .orderBy(asc(posts.scheduledAt)),
    db.select().from(campaignResults).where(eq(campaignResults.campaignId, campaignId)).orderBy(desc(campaignResults.day), desc(campaignResults.createdAt)),
  ]);
  return { campaign, pieces: pieceRows, posts: postRows, results };
}

/** Whether a campaign belongs to the workspace (for linking posts). */
export async function campaignExists(db: Database, workspaceId: string, campaignId: string): Promise<boolean> {
  const [row] = await db.select({ n: count() }).from(campaigns).where(and(eq(campaigns.id, campaignId), eq(campaigns.workspaceId, workspaceId)));
  return (row?.n ?? 0) > 0;
}

// ------------------------------------------------------------------ pieces

/** Adds an empty ad, print piece or spot to a campaign. */
export async function createPiece(
  db: Database,
  workspaceId: string,
  campaignId: string,
  input: { kind: PieceKind; format: string; title: string },
  source: 'manual' | 'ai' = 'manual',
): Promise<Piece> {
  if (!(PIECE_KINDS as readonly string[]).includes(input.kind) || !isPieceFormat(input.kind, input.format)) throw new CampaignError((m) => m.format);
  const title = input.title.trim();
  if (!title) throw new CampaignError((m) => m.pieceTitle);
  if (!(await campaignExists(db, workspaceId, campaignId))) throw new CampaignError((m) => m.notFound);
  const [row] = await db
    .insert(pieces)
    .values({ workspaceId, campaignId, kind: input.kind, format: input.format, title: title.slice(0, 160), content: emptyContent(input.kind, input.format) as unknown as Record<string, unknown>, source })
    .returning();
  return row!;
}

export async function getPiece(db: Database, workspaceId: string, pieceId: string): Promise<Piece | null> {
  return (await db.query.pieces.findFirst({ where: and(eq(pieces.id, pieceId), eq(pieces.workspaceId, workspaceId)) })) ?? null;
}

/**
 * Moves a piece along draft → approved → live → done. Approving records who
 * approved it; editing an approved piece's content sends it back to draft.
 */
export async function setPieceStatus(db: Database, workspaceId: string, pieceId: string, status: PieceStatus, userId: string): Promise<Piece> {
  if (!(PIECE_STATUSES as readonly string[]).includes(status)) throw new CampaignError((m) => m.format);
  const current = await getPiece(db, workspaceId, pieceId);
  if (!current) throw new CampaignError((m) => m.pieceNotFound);
  // Nothing goes out unapproved.
  if ((status === 'live' || status === 'done') && current.status === 'draft') throw new CampaignError((m) => m.approveFirst);
  const approval = status === 'draft' ? { approvedBy: null, approvedAt: null } : status === 'approved' ? { approvedBy: userId, approvedAt: new Date() } : {};
  const [row] = await db
    .update(pieces)
    .set({ status, ...approval, updatedAt: new Date() })
    .where(and(eq(pieces.id, pieceId), eq(pieces.workspaceId, workspaceId)))
    .returning();
  if (!row) throw new CampaignError((m) => m.pieceNotFound);
  return row;
}

/** Saves a piece's title and content (already checked by its kind's rules) and the uploads it uses. */
export async function savePiece(db: Database, workspaceId: string, pieceId: string, input: { title: string; content: object; mediaIds: string[] }): Promise<Piece> {
  const title = input.title.trim();
  if (!title) throw new CampaignError((m) => m.pieceTitle);
  const [row] = await db
    .update(pieces)
    .set({ title: title.slice(0, 160), content: input.content as Record<string, unknown>, mediaIds: [...new Set(input.mediaIds)], status: 'draft', approvedBy: null, approvedAt: null, updatedAt: new Date() })
    .where(and(eq(pieces.id, pieceId), eq(pieces.workspaceId, workspaceId)))
    .returning();
  if (!row) throw new CampaignError((m) => m.pieceNotFound);
  return row;
}

export async function deletePiece(db: Database, workspaceId: string, pieceId: string): Promise<Piece | undefined> {
  const [row] = await db
    .delete(pieces)
    .where(and(eq(pieces.id, pieceId), eq(pieces.workspaceId, workspaceId)))
    .returning();
  return row;
}

// ------------------------------------------------------------------ results

export interface ResultInput {
  channel: string;
  day: string;
  reach: number;
  clicks: number;
  leads: number;
  sales: number;
  revenueCents: number;
  spendCents: number;
  note: string;
}

export async function addResult(db: Database, workspaceId: string, campaignId: string, userId: string, input: ResultInput): Promise<CampaignResult> {
  if (!(CHANNELS as readonly string[]).includes(input.channel)) throw new CampaignError((m) => m.channel);
  const resultDay = day(input.day);
  if (!resultDay) throw new CampaignError((m) => m.day);
  const numbers = [input.reach, input.clicks, input.leads, input.sales, input.revenueCents, input.spendCents];
  if (!numbers.every(isCount)) throw new CampaignError((m) => m.numbers);
  if (!(await campaignExists(db, workspaceId, campaignId))) throw new CampaignError((m) => m.notFound);
  const [row] = await db
    .insert(campaignResults)
    .values({
      workspaceId,
      campaignId,
      channel: input.channel,
      day: resultDay,
      reach: input.reach,
      clicks: input.clicks,
      leads: input.leads,
      sales: input.sales,
      revenueCents: input.revenueCents,
      spendCents: input.spendCents,
      note: longText(input.note, 500),
      createdBy: userId,
    })
    .returning();
  return row!;
}

export async function deleteResult(db: Database, workspaceId: string, resultId: string): Promise<void> {
  await db.delete(campaignResults).where(and(eq(campaignResults.id, resultId), eq(campaignResults.workspaceId, workspaceId)));
}

export interface ChannelTotals {
  channel: string;
  plannedCents: number;
  spendCents: number;
  reach: number;
  clicks: number;
  leads: number;
  sales: number;
  revenueCents: number;
  /** Spend per lead, when there were leads. */
  costPerLeadCents: number | null;
  /** Revenue per unit of spend, when there was spend. */
  roas: number | null;
}

const ratios = (totals: Omit<ChannelTotals, 'costPerLeadCents' | 'roas'>): ChannelTotals => ({
  ...totals,
  costPerLeadCents: totals.leads > 0 ? Math.round(totals.spendCents / totals.leads) : null,
  roas: totals.spendCents > 0 ? totals.revenueCents / totals.spendCents : null,
});

/** Plan against results, per channel (planned channels and channels with results) and in total. */
export function summarizeCampaign(campaign: Pick<Campaign, 'budgetCents' | 'channels'>, results: CampaignResult[], pieceList: Pick<Piece, 'kind' | 'format'>[] = []) {
  const byChannel = new Map<string, Omit<ChannelTotals, 'costPerLeadCents' | 'roas'>>();
  const entry = (channel: string) => {
    if (!byChannel.has(channel)) byChannel.set(channel, { channel, plannedCents: 0, spendCents: 0, reach: 0, clicks: 0, leads: 0, sales: 0, revenueCents: 0 });
    return byChannel.get(channel)!;
  };
  for (const planned of campaign.channels) entry(planned.channel).plannedCents += planned.budgetCents;
  for (const piece of pieceList) entry(pieceChannel(piece.kind as PieceKind, piece.format));
  for (const result of results) {
    const totals = entry(result.channel);
    totals.spendCents += result.spendCents;
    totals.reach += result.reach;
    totals.clicks += result.clicks;
    totals.leads += result.leads;
    totals.sales += result.sales;
    totals.revenueCents += result.revenueCents;
  }
  const channels = [...byChannel.values()].sort((a, b) => CHANNELS.indexOf(a.channel as Channel) - CHANNELS.indexOf(b.channel as Channel)).map(ratios);
  const sum = (key: 'plannedCents' | 'spendCents' | 'reach' | 'clicks' | 'leads' | 'sales' | 'revenueCents') => channels.reduce((total, channel) => total + channel[key], 0);
  const total = ratios({ channel: 'total', plannedCents: sum('plannedCents'), spendCents: sum('spendCents'), reach: sum('reach'), clicks: sum('clicks'), leads: sum('leads'), sales: sum('sales'), revenueCents: sum('revenueCents') });
  return { channels, total, budgetCents: campaign.budgetCents, unplannedCents: campaign.budgetCents - total.plannedCents };
}

// ------------------------------------------------------------------ print pieces

const MAX_PRINT_TEXT = { headline: 160, body: 4000, callToAction: 80 };

/** Checks a print piece's content; throws CampaignError with what to fix. */
export function cleanPrintContent(format: string, input: PrintContent): PrintContent {
  const text = (value: string, max: number) => longText(String(value ?? ''), max);
  const qrUrl = String(input.qrUrl ?? '').trim();
  if (qrUrl && (!/^https?:\/\/\S+$/i.test(qrUrl) || qrUrl.length > 500)) throw new CampaignError((m) => m.link);
  const content: PrintContent = {
    headline: text(input.headline, MAX_PRINT_TEXT.headline),
    body: text(input.body, MAX_PRINT_TEXT.body),
    callToAction: text(input.callToAction, MAX_PRINT_TEXT.callToAction),
    showCharacter: Boolean(input.showCharacter),
    showLogo: Boolean(input.showLogo),
    showContact: Boolean(input.showContact),
    qrUrl,
    ...(input.imageMediaId && { imageMediaId: input.imageMediaId }),
  };
  if (format === 'newspaper') {
    const size = (value: unknown) => {
      const mm = Math.round(Number(value));
      if (!Number.isFinite(mm) || mm < 20 || mm > 1200) throw new CampaignError((m) => m.size);
      return mm;
    };
    content.widthMm = size(input.widthMm);
    content.heightMm = size(input.heightMm);
  }
  return content;
}

/** Saves a print piece; its picture must be an image uploaded to the workspace. Sends the piece back to draft. */
export async function savePrintPiece(db: Database, workspaceId: string, pieceId: string, input: { title: string; content: PrintContent }): Promise<Piece> {
  const piece = await getPiece(db, workspaceId, pieceId);
  if (!piece || piece.kind !== 'print') throw new CampaignError((m) => m.pieceNotFound);
  const content = cleanPrintContent(piece.format, input.content);
  const mediaIds = content.imageMediaId ? [content.imageMediaId] : [];
  const found = await findMedia(db, workspaceId, mediaIds);
  if (mediaIds.some((id) => found.get(id)?.kind !== 'image')) throw new CampaignError((m) => m.notAnImage);
  return savePiece(db, workspaceId, pieceId, { title: input.title, content, mediaIds });
}
