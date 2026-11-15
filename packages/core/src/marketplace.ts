/**
 * A workspace's connection to a marketplace's publisher tools, for markets
 * that name one (`marketplace.integration`, today Partner Center for
 * AppSource): leads posted to the workspace's lead endpoint, the
 * marketplace's daily numbers, and sending an approved listing's texts.
 *
 * Numbers and leads count for the campaign that markets the product on that
 * day: the one whose dates cover the day (the latest to start), or an undated
 * running one. Without such a campaign a lead is still kept, a day's numbers
 * are not booked anywhere.
 */
import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { campaignResults, campaigns, marketplaceConnections, marketplaceLeads, pieces, products, type Database, type MarketplaceConnection, type MarketplaceLead, type Piece, type Product } from '@maas/db';
import { CampaignError } from './campaigns';
import { decryptJson, encryptJson } from './crypto';
import type { MarketManifest } from './market';
import type { ListingContent } from './marketing';
import { cleanCredentials, insightsRows, PartnerCenterClient, PartnerCenterError, partnerCenterProductId, type PartnerCenterCredentials } from './partner-center';
import { campaignMarket } from './products';

/** Results rows this module writes, told apart from people's own entries. */
export const MARKETPLACE_SOURCES = { insights: 'partner-center:insights', leads: 'partner-center:leads' } as const;
/** How often the worker reads a connection's numbers; the report itself is daily. */
export const MARKETPLACE_SYNC_MS = 6 * 60 * 60_000;

export type ClientFactory = (credentials: PartnerCenterCredentials) => PartnerCenterClient;
const defaultClient: ClientFactory = (credentials) => new PartnerCenterClient(credentials);

export async function getConnection(db: Database, workspaceId: string, marketId: string): Promise<MarketplaceConnection | null> {
  return (await db.query.marketplaceConnections.findFirst({ where: and(eq(marketplaceConnections.workspaceId, workspaceId), eq(marketplaceConnections.marketId, marketId)) })) ?? null;
}

/** The connection, created on first use so the lead endpoint's address exists. */
export async function ensureConnection(db: Database, workspaceId: string, marketId: string): Promise<MarketplaceConnection> {
  await db
    .insert(marketplaceConnections)
    .values({ workspaceId, marketId, leadToken: randomBytes(24).toString('base64url') })
    .onConflictDoNothing();
  return (await getConnection(db, workspaceId, marketId))!;
}

/** Checks the credentials with Microsoft, then stores them encrypted. */
export async function saveCredentials(db: Database, workspaceId: string, marketId: string, input: PartnerCenterCredentials, client: ClientFactory = defaultClient): Promise<void> {
  const credentials = cleanCredentials(input);
  if (!credentials) throw new PartnerCenterError('credentials');
  await client(credentials).check();
  await ensureConnection(db, workspaceId, marketId);
  await db
    .update(marketplaceConnections)
    .set({ credentials: encryptJson(credentials), reportId: null, lastSyncError: null, updatedAt: new Date() })
    .where(and(eq(marketplaceConnections.workspaceId, workspaceId), eq(marketplaceConnections.marketId, marketId)));
}

/** Forgets the credentials; the lead endpoint keeps working. */
export async function removeCredentials(db: Database, workspaceId: string, marketId: string): Promise<void> {
  await db
    .update(marketplaceConnections)
    .set({ credentials: null, reportId: null, lastSyncAt: null, lastSyncError: null, updatedAt: new Date() })
    .where(and(eq(marketplaceConnections.workspaceId, workspaceId), eq(marketplaceConnections.marketId, marketId)));
}

/** A new lead address; the old one stops working. */
export async function renewLeadToken(db: Database, workspaceId: string, marketId: string): Promise<void> {
  await ensureConnection(db, workspaceId, marketId);
  await db
    .update(marketplaceConnections)
    .set({ leadToken: randomBytes(24).toString('base64url'), updatedAt: new Date() })
    .where(and(eq(marketplaceConnections.workspaceId, workspaceId), eq(marketplaceConnections.marketId, marketId)));
}

function clientFor(connection: MarketplaceConnection, client: ClientFactory): PartnerCenterClient | null {
  return connection.credentials ? client(decryptJson<PartnerCenterCredentials>(connection.credentials)) : null;
}

// ------------------------------------------------------------------ attribution

const normalize = (text: string) => text.trim().toLocaleLowerCase();

/** How the marketplace names a product's offer: its "offer_name", else its name. */
export const offerName = (product: Pick<Product, 'name' | 'profile'>) => {
  const named = product.profile.offer_name;
  return (typeof named === 'string' && named.trim()) || product.name;
};

async function productByOffer(db: Database, workspaceId: string, marketId: string, offer: string): Promise<Product | null> {
  const wanted = normalize(offer);
  if (!wanted) return null;
  const candidates = await db.query.products.findMany({ where: and(eq(products.workspaceId, workspaceId), eq(products.marketId, marketId)) });
  return candidates.find((product) => normalize(offerName(product)) === wanted) ?? null;
}

/** The campaign a product's numbers of a day count for. */
export async function campaignForDay(db: Database, workspaceId: string, productId: string, day: string): Promise<string | null> {
  const [row] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.workspaceId, workspaceId),
        eq(campaigns.productId, productId),
        or(
          and(or(isNull(campaigns.startsOn), sql`${campaigns.startsOn} <= ${day}`), or(isNull(campaigns.endsOn), sql`${campaigns.endsOn} >= ${day}`), or(isNotNull(campaigns.startsOn), isNotNull(campaigns.endsOn))),
          and(isNull(campaigns.startsOn), isNull(campaigns.endsOn), eq(campaigns.status, 'running')),
        ),
      ),
    )
    .orderBy(sql`${campaigns.startsOn} desc nulls last`, desc(campaigns.createdAt))
    .limit(1);
  return row?.id ?? null;
}

/** Sets (or adds to) the marketplace's numbers of one source on one day; one row per campaign, day and source. */
async function bookResult(db: Database, workspaceId: string, campaignId: string, day: string, source: string, numbers: { reach?: number; clicks?: number; leads?: number }, mode: 'replace' | 'add'): Promise<void> {
  await db.transaction(async (tx) => {
    const where = and(eq(campaignResults.campaignId, campaignId), eq(campaignResults.day, day), eq(campaignResults.source, source));
    const [current] = await tx.select().from(campaignResults).where(where).for('update');
    const next = {
      reach: (mode === 'add' ? (current?.reach ?? 0) : 0) + (numbers.reach ?? 0),
      clicks: (mode === 'add' ? (current?.clicks ?? 0) : 0) + (numbers.clicks ?? 0),
      leads: (mode === 'add' ? (current?.leads ?? 0) : 0) + (numbers.leads ?? 0),
    };
    if (current) await tx.update(campaignResults).set(next).where(eq(campaignResults.id, current.id));
    else await tx.insert(campaignResults).values({ workspaceId, campaignId, channel: 'marketplace', day, source, ...next });
  });
}

// ------------------------------------------------------------------ leads

/** What Partner Center posts for a lead (its "HTTPS endpoint" lead destination). */
export interface LeadPayload {
  ActionCode?: string;
  OfferTitle?: string;
  LeadSource?: string;
  Description?: string;
  UserDetails?: { FirstName?: string; LastName?: string; Email?: string; Phone?: string; Country?: string; Company?: string; Title?: string };
}

/** Actions that are a lead for the publisher; "DNC" (do not contact) is kept but not counted. */
const COUNTED_ACTIONS = new Set(['INS', 'PLT', 'CREATE']);

const field = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/**
 * Takes a lead posted to a lead address. Returns false for an unknown
 * address. The lead is kept with its product when the offer matches one.
 */
export async function receiveLead(db: Database, leadToken: string, payload: unknown, now = new Date()): Promise<boolean> {
  if (!/^[\w-]{20,64}$/.test(leadToken)) return false;
  const connection = await db.query.marketplaceConnections.findFirst({ where: eq(marketplaceConnections.leadToken, leadToken) });
  if (!connection) return false;
  const body = (payload && typeof payload === 'object' ? payload : {}) as LeadPayload;
  const user = (body.UserDetails && typeof body.UserDetails === 'object' ? body.UserDetails : {}) as NonNullable<LeadPayload['UserDetails']>;
  // "Source-Action | Offer" is the documented form of LeadSource; the offer's title is also sent on its own.
  const offer = field(body.OfferTitle, 300) || field(body.LeadSource, 300).split('|').slice(1).join('|').trim();
  const action = (field(body.ActionCode, 20) || /-(\w+)\s*\|/.exec(field(body.LeadSource, 300))?.[1] || '').toUpperCase();
  const product = await productByOffer(db, connection.workspaceId, connection.marketId, offer);
  await db.insert(marketplaceLeads).values({
    workspaceId: connection.workspaceId,
    marketId: connection.marketId,
    productId: product?.id ?? null,
    action,
    offerTitle: offer,
    firstName: field(user.FirstName, 120),
    lastName: field(user.LastName, 120),
    email: field(user.Email, 254),
    phone: field(user.Phone, 60),
    company: field(user.Company, 200),
    title: field(user.Title, 120),
    country: field(user.Country, 80),
    description: field(body.Description, 2000),
    receivedAt: now,
  });
  if (product && COUNTED_ACTIONS.has(action)) {
    const day = now.toISOString().slice(0, 10);
    const campaignId = await campaignForDay(db, connection.workspaceId, product.id, day);
    if (campaignId) await bookResult(db, connection.workspaceId, campaignId, day, MARKETPLACE_SOURCES.leads, { leads: 1 }, 'add');
  }
  return true;
}

export async function listLeads(db: Database, workspaceId: string, options: { productId?: string; limit?: number } = {}): Promise<MarketplaceLead[]> {
  return db.query.marketplaceLeads.findMany({
    where: and(eq(marketplaceLeads.workspaceId, workspaceId), options.productId ? eq(marketplaceLeads.productId, options.productId) : undefined),
    orderBy: [desc(marketplaceLeads.receivedAt)],
    limit: options.limit ?? 100,
  });
}

/** Deletes one lead, or all of a product's (personal data, kept until people delete it). */
export async function deleteLeads(db: Database, workspaceId: string, which: { leadId?: string; productId?: string }): Promise<number> {
  if (!which.leadId && !which.productId) return 0;
  const rows = await db
    .delete(marketplaceLeads)
    .where(and(eq(marketplaceLeads.workspaceId, workspaceId), which.leadId ? eq(marketplaceLeads.id, which.leadId) : eq(marketplaceLeads.productId, which.productId!)))
    .returning({ id: marketplaceLeads.id });
  return rows.length;
}

// ------------------------------------------------------------------ numbers

export type SyncOutcome = { status: 'notConnected' } | { status: 'scheduled' } | { status: 'waiting' } | { status: 'synced'; days: number };

/**
 * Reads the marketplace's numbers into the campaigns' results: schedules the
 * daily report the first time, then imports its newest run. A day's numbers
 * replace what an earlier run booked for that day.
 */
export async function syncMarketplace(db: Database, workspaceId: string, marketId: string, client: ClientFactory = defaultClient, now = new Date()): Promise<SyncOutcome> {
  const connection = await getConnection(db, workspaceId, marketId);
  const partner = connection && clientFor(connection, client);
  if (!connection || !partner) return { status: 'notConnected' };
  const done = (fields: Partial<MarketplaceConnection>) =>
    db
      .update(marketplaceConnections)
      .set({ lastSyncAt: now, lastSyncError: null, updatedAt: now, ...fields })
      .where(and(eq(marketplaceConnections.workspaceId, workspaceId), eq(marketplaceConnections.marketId, marketId)));
  try {
    if (!connection.reportId) {
      await done({ reportId: await partner.scheduleInsightsReport(new Date(now.getTime() + 5 * 60_000)) });
      return { status: 'scheduled' };
    }
    let csv: string | null;
    try {
      csv = await partner.latestInsights(connection.reportId);
    } catch (error) {
      // A report Microsoft no longer knows (expired or deleted) is scheduled anew.
      if (error instanceof PartnerCenterError && error.reason === 'notFound') {
        await done({ reportId: await partner.scheduleInsightsReport(new Date(now.getTime() + 5 * 60_000)) });
        return { status: 'scheduled' };
      }
      throw error;
    }
    if (csv === null) {
      await done({});
      return { status: 'waiting' };
    }
    const rows = insightsRows(csv);
    const known = await db.query.products.findMany({ where: and(eq(products.workspaceId, workspaceId), eq(products.marketId, marketId)) });
    const byOffer = new Map(known.map((product) => [normalize(offerName(product)), product]));
    let days = 0;
    for (const row of rows) {
      const product = byOffer.get(normalize(row.offerName));
      if (!product) continue;
      const campaignId = await campaignForDay(db, workspaceId, product.id, row.day);
      if (!campaignId) continue;
      await bookResult(db, workspaceId, campaignId, row.day, MARKETPLACE_SOURCES.insights, { reach: row.pageVisits, clicks: row.getItNow + row.contactMe + row.freeTrial }, 'replace');
      days++;
    }
    await done({});
    return { status: 'synced', days };
  } catch (error) {
    if (!(error instanceof PartnerCenterError)) throw error;
    await db
      .update(marketplaceConnections)
      .set({ lastSyncAt: now, lastSyncError: error.reason, updatedAt: now })
      .where(and(eq(marketplaceConnections.workspaceId, workspaceId), eq(marketplaceConnections.marketId, marketId)));
    throw error;
  }
}

/** The worker's part: reads every connection with credentials whose last read is older than MARKETPLACE_SYNC_MS. */
export async function syncAllMarketplaces(db: Database, client: ClientFactory = defaultClient, now = new Date()): Promise<number> {
  const due = await db.query.marketplaceConnections.findMany({
    where: and(isNotNull(marketplaceConnections.credentials), or(isNull(marketplaceConnections.lastSyncAt), lt(marketplaceConnections.lastSyncAt, new Date(now.getTime() - MARKETPLACE_SYNC_MS)))),
    orderBy: [asc(marketplaceConnections.lastSyncAt)],
  });
  let synced = 0;
  for (const connection of due) {
    try {
      await syncMarketplace(db, connection.workspaceId, connection.marketId, client, now);
      synced++;
    } catch (error) {
      // Recorded on the connection; one failing workspace does not stop the others.
      if (!(error instanceof PartnerCenterError)) console.error('marketplace sync failed', connection.marketId, error);
    }
  }
  return synced;
}

// ------------------------------------------------------------------ the listing

export interface SendCheck {
  market: MarketManifest;
  product: Product;
  /** The offer's product ID in the marketplace, from the product's profile. */
  marketplaceProductId: string | null;
  connected: boolean;
}

/** Whether an approved listing can be sent, and where to; null when its market has no publisher tools. */
export async function listingDestination(db: Database, workspaceId: string, piece: Pick<Piece, 'campaignId'>): Promise<SendCheck | null> {
  const campaign = await db.query.campaigns.findFirst({ where: and(eq(campaigns.id, piece.campaignId), eq(campaigns.workspaceId, workspaceId)) });
  const context = campaign && (await campaignMarket(db, workspaceId, campaign));
  if (!context?.market || context.market.marketplace.integration !== 'partner-center') return null;
  const connection = await getConnection(db, workspaceId, context.market.id);
  const id = context.product.profile.partner_center_id;
  return { market: context.market, product: context.product, marketplaceProductId: typeof id === 'string' ? partnerCenterProductId(id) : null, connected: Boolean(connection?.credentials) };
}

const link = (value: unknown) => (typeof value === 'string' && /^https:\/\/\S+$/.test(value.trim()) ? value.trim() : undefined);

/**
 * Writes an approved listing's texts into the offer's draft in Partner
 * Center and waits for Microsoft to take them. Publishing stays in Partner
 * Center, where people also upload the screenshots and documents.
 */
export async function sendListing(db: Database, workspaceId: string, pieceId: string, client: ClientFactory = defaultClient, wait?: { attempts: number; delayMs: number }): Promise<void> {
  const piece = await db.query.pieces.findFirst({ where: and(eq(pieces.id, pieceId), eq(pieces.workspaceId, workspaceId)) });
  if (!piece || piece.kind !== 'listing') throw new CampaignError((m) => m.pieceNotFound);
  if (piece.status !== 'approved' && piece.status !== 'live') throw new CampaignError((m) => m.approveFirst);
  const destination = await listingDestination(db, workspaceId, piece);
  if (!destination) throw new CampaignError((m) => m.marketMissing);
  if (!destination.marketplaceProductId) throw new PartnerCenterError('notFound');
  const connection = await getConnection(db, workspaceId, destination.market.id);
  const partner = connection && clientFor(connection, client);
  if (!partner) throw new PartnerCenterError('credentials');
  const content = piece.content as unknown as ListingContent;
  const jobId = await partner.sendListing(destination.marketplaceProductId, {
    title: content.texts.name ?? '',
    summary: content.texts.summary ?? '',
    description: content.texts.description ?? '',
    keywords: content.keywords ?? [],
    helpLink: link(destination.product.profile.help),
    privacyPolicyLink: link(destination.product.profile.privacy),
  });
  await partner.waitForJob(jobId, wait);
}

