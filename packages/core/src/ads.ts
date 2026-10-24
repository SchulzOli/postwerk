/**
 * Paid ads: ad accounts a workspace connected, ad pieces launched there as
 * campaigns (always paused first, with a budget cap and an end date), and
 * their numbers synced back into the campaign's results by the worker.
 */
import { and, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { adAccounts, adLaunches, campaignResults, campaigns, pieces, type AdAccount, type AdLaunch, type Database } from '@maas/db';
import {
  expiresSoon,
  GOOGLE_TOKEN_URL,
  googleAds,
  metaAds,
  ProviderError,
  tokenRequest,
  type AdAccountInfo,
  type AdLaunchSpec,
  type AdPlatform,
  type AdPlatformId,
} from '@maas/providers';
import { getBrandKit } from './brand';
import { adVideoId, CampaignError } from './campaigns';
import { decryptJson, encryptJson } from './crypto';
import { AD_COUNTRIES, AD_FORMATS, AD_LANGUAGES, adProblems, pieceChannel, type AdContent, type AdFormat } from './marketing';
import { findMedia } from './media';
import { uploadBytes } from './print';

type Env = Record<string, string | undefined>;

export interface GoogleAdsCredentials {
  refreshToken: string;
  accessToken?: string;
  expiresAt?: number;
}
export interface MetaAdsCredentials {
  accessToken: string;
  expiresAt?: number;
}

/** What the server admin set up: Google Ads needs the Google app and a developer token; Meta Ads the Facebook app and ENABLE_META_ADS. */
export function adsSetup(env: Env = process.env) {
  const googleClient = env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim() ? { clientId: env.GOOGLE_CLIENT_ID.trim(), clientSecret: env.GOOGLE_CLIENT_SECRET.trim() } : null;
  const facebookClient = env.FACEBOOK_CLIENT_ID?.trim() && env.FACEBOOK_CLIENT_SECRET?.trim() ? { clientId: env.FACEBOOK_CLIENT_ID.trim(), clientSecret: env.FACEBOOK_CLIENT_SECRET.trim() } : null;
  const developerToken = env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  return {
    google_ads:
      googleClient && developerToken
        ? { client: googleClient, developerToken, loginCustomerId: env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/\D/g, '') || undefined, baseUrl: env.GOOGLE_ADS_API_URL?.trim() || undefined }
        : null,
    meta_ads: facebookClient && env.ENABLE_META_ADS === 'true' ? { client: facebookClient, baseUrl: env.META_GRAPH_URL?.trim() || undefined } : null,
  };
}

/** The platform's API client, when the server admin set it up. */
export function adPlatform(id: AdPlatformId, env: Env = process.env): AdPlatform | null {
  const setup = adsSetup(env);
  if (id === 'google_ads') return setup.google_ads && googleAds(setup.google_ads);
  return setup.meta_ads && metaAds({ baseUrl: setup.meta_ads.baseUrl });
}

/** Which platform runs an ad format. */
export const platformOf = (format: string): AdPlatformId => AD_FORMATS[format as AdFormat]?.platform ?? 'google_ads';

// ------------------------------------------------------------------ accounts

/** Stores the ad accounts one sign-in gave access to (they share its credentials). */
export async function saveAdAccounts(db: Database, workspaceId: string, platform: AdPlatformId, accounts: AdAccountInfo[], credentials: GoogleAdsCredentials | MetaAdsCredentials, userId: string): Promise<AdAccount[]> {
  const saved: AdAccount[] = [];
  for (const account of accounts) {
    const values = {
      name: account.name,
      currency: account.currency,
      timeZone: account.timeZone ?? null,
      test: account.test ?? false,
      pages: account.pages ?? [],
      credentialsEnc: encryptJson(credentials),
      status: 'active' as const,
      connectedBy: userId,
      updatedAt: new Date(),
    };
    const [row] = await db
      .insert(adAccounts)
      .values({ workspaceId, platform, externalId: account.id, ...values })
      .onConflictDoUpdate({ target: [adAccounts.workspaceId, adAccounts.platform, adAccounts.externalId], set: values })
      .returning();
    saved.push(row!);
  }
  return saved;
}

export type AdAccountView = Omit<AdAccount, 'credentialsEnc'>;

export async function listAdAccounts(db: Database, workspaceId: string): Promise<AdAccountView[]> {
  const rows = await db.select().from(adAccounts).where(eq(adAccounts.workspaceId, workspaceId)).orderBy(adAccounts.platform, adAccounts.name);
  return rows.map(({ credentialsEnc: _, ...row }) => row);
}

/** Removes an ad account; refused while one of its campaigns is running (pause it first). */
export async function removeAdAccount(db: Database, workspaceId: string, adAccountId: string): Promise<AdAccountView | undefined> {
  const running = await db.select({ id: adLaunches.id }).from(adLaunches).where(and(eq(adLaunches.adAccountId, adAccountId), eq(adLaunches.status, 'running')));
  if (running.length > 0) throw new CampaignError((m) => m.adAccountInUse);
  const [row] = await db.delete(adAccounts).where(and(eq(adAccounts.id, adAccountId), eq(adAccounts.workspaceId, workspaceId))).returning();
  if (!row) return undefined;
  const { credentialsEnc: _, ...view } = row;
  return view;
}

/** A fresh access token for an account; Google tokens are renewed and saved, expired ones mark the account for reconnecting. */
async function accessFor(db: Database, account: AdAccount, env: Env = process.env, now = Date.now()) {
  try {
    if (account.status === 'needs_reauth') throw new ProviderError('The ad account needs to be connected again.', { needsReauth: true });
    if (account.platform === 'google_ads') {
      const setup = adsSetup(env).google_ads;
      if (!setup) throw new ProviderError('Google Ads is not set up on this server.', { retryable: true });
      let credentials = decryptJson<GoogleAdsCredentials>(account.credentialsEnc);
      if (!credentials.accessToken || expiresSoon(credentials, now) || credentials.expiresAt === undefined) {
        const tokens = await tokenRequest(GOOGLE_TOKEN_URL, setup.client, { grant_type: 'refresh_token', refresh_token: credentials.refreshToken });
        credentials = { refreshToken: tokens.refreshToken ?? credentials.refreshToken, accessToken: tokens.accessToken, expiresAt: tokens.expiresAt };
        await db.update(adAccounts).set({ credentialsEnc: encryptJson(credentials), updatedAt: new Date() }).where(eq(adAccounts.id, account.id));
      }
      return { accessToken: credentials.accessToken!, accountId: account.externalId };
    }
    const credentials = decryptJson<MetaAdsCredentials>(account.credentialsEnc);
    if (credentials.expiresAt !== undefined && credentials.expiresAt <= now) throw new ProviderError('Meta Ads access has expired. Please connect the ad account again.', { needsReauth: true });
    return { accessToken: credentials.accessToken, accountId: account.externalId };
  } catch (error) {
    if (error instanceof ProviderError && error.needsReauth) await db.update(adAccounts).set({ status: 'needs_reauth', updatedAt: new Date() }).where(eq(adAccounts.id, account.id));
    throw error;
  }
}

/** Runs a platform call; a revoked token marks the account for reconnecting. */
async function withAccount<T>(db: Database, account: AdAccount, run: (platform: AdPlatform, access: { accessToken: string; accountId: string }) => Promise<T>, env: Env = process.env): Promise<T> {
  const platform = adPlatform(account.platform, env);
  if (!platform) throw new ProviderError(`${account.platform === 'google_ads' ? 'Google Ads' : 'Meta Ads'} is not set up on this server.`);
  const access = await accessFor(db, account, env);
  try {
    return await run(platform, access);
  } catch (error) {
    if (error instanceof ProviderError && error.needsReauth) await db.update(adAccounts).set({ status: 'needs_reauth', updatedAt: new Date() }).where(eq(adAccounts.id, account.id));
    throw error;
  }
}

// ------------------------------------------------------------------ launching

export interface LaunchInput {
  adAccountId: string;
  /** The most it may spend, in the ad account's currency (cents). */
  budgetCents: number;
  startsOn: string;
  endsOn: string;
  countries: string[];
  language: string;
  /** Meta: the Facebook Page the ad runs as. */
  pageId?: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const todayOf = (now: Date) => now.toISOString().slice(0, 10);

/**
 * Builds an approved ad as a campaign on its platform, paused. Spending only
 * starts with `setAdRunning`.
 */
export async function launchAd(db: Database, workspace: { id: string; name: string }, userId: string, pieceId: string, input: LaunchInput, options: { env?: Env; now?: Date } = {}): Promise<AdLaunch> {
  const now = options.now ?? new Date();
  const piece = await db.query.pieces.findFirst({ where: and(eq(pieces.id, pieceId), eq(pieces.workspaceId, workspace.id)) });
  if (!piece || piece.kind !== 'ad') throw new CampaignError((m) => m.pieceNotFound);
  if (piece.status !== 'approved' && piece.status !== 'live') throw new CampaignError((m) => m.approveFirst);
  const existing = await db.query.adLaunches.findFirst({ where: eq(adLaunches.pieceId, pieceId) });
  if (existing) throw new CampaignError((m) => m.alreadyLaunched);
  const content = piece.content as unknown as AdContent;
  const video = piece.format === 'video' ? await adVideoId(db, workspace.id, content) : null;
  if (adProblems(piece.format, content, video).length > 0) throw new CampaignError((m) => m.adIncomplete);

  const account = await db.query.adAccounts.findFirst({ where: and(eq(adAccounts.id, input.adAccountId), eq(adAccounts.workspaceId, workspace.id)) });
  if (!account || account.platform !== platformOf(piece.format)) throw new CampaignError((m) => m.adAccount);
  if (!Number.isInteger(input.budgetCents) || input.budgetCents < 100 || input.budgetCents > 2_000_000_000) throw new CampaignError((m) => m.budget);
  if (!DAY.test(input.startsOn) || !DAY.test(input.endsOn) || input.endsOn < input.startsOn || input.endsOn < todayOf(now)) throw new CampaignError((m) => m.adDates);
  const countries = [...new Set(input.countries)].filter((country) => (AD_COUNTRIES as readonly string[]).includes(country));
  if (countries.length === 0) throw new CampaignError((m) => m.adCountries);
  const language = (AD_LANGUAGES as readonly string[]).includes(input.language) ? input.language : 'de';
  if (account.platform === 'meta_ads' && !account.pages.some((page) => page.id === input.pageId)) throw new CampaignError((m) => m.adPage);

  const campaign = await db.query.campaigns.findFirst({ where: eq(campaigns.id, piece.campaignId) });
  const kit = await getBrandKit(db, workspace);
  // Social ads show their picture; video ads need the brand's square logo.
  const imageId = piece.format === 'social' ? content.imageMediaId : piece.format === 'video' ? kit.logoMediaId : null;
  let image: AdLaunchSpec['image'];
  if (imageId) {
    const row = (await findMedia(db, workspace.id, [imageId])).get(imageId);
    const bytes = row?.kind === 'image' ? await uploadBytes(row.key) : null;
    if (bytes) image = { bytes, name: row!.key.split('/').pop()! };
  }
  if (piece.format === 'social' && !image) throw new CampaignError((m) => m.adIncomplete);
  if (piece.format === 'video' && !image) throw new CampaignError((m) => m.adLogo);

  const spec: AdLaunchSpec = {
    name: `${campaign?.name ?? 'Campaign'} – ${piece.title}`.slice(0, 250),
    format: piece.format as AdLaunchSpec['format'],
    goal: campaign?.goal ?? 'traffic',
    budgetMinor: input.budgetCents,
    startsOn: input.startsOn < todayOf(now) ? todayOf(now) : input.startsOn,
    endsOn: input.endsOn,
    countries,
    language,
    finalUrl: content.finalUrl,
    headlines: content.headlines,
    descriptions: content.descriptions,
    longHeadlines: content.longHeadlines,
    path1: content.path1,
    path2: content.path2,
    keywords: content.keywords,
    businessName: kit.companyName.slice(0, 25),
    callToAction: content.callToAction || undefined,
    image,
    youtubeVideoId: video ?? undefined,
    pageId: input.pageId,
  };
  const launched = await withAccount(db, account, (platform, access) => platform.launch(access, spec), options.env);
  const [row] = await db
    .insert(adLaunches)
    .values({
      workspaceId: workspace.id,
      pieceId,
      adAccountId: account.id,
      externalId: launched.campaignId,
      url: launched.url,
      budgetCents: input.budgetCents,
      currency: account.currency,
      startsOn: spec.startsOn,
      endsOn: spec.endsOn,
      countries,
      createdBy: userId,
    })
    .returning();
  return row!;
}

/** Starts or pauses a launched campaign on its platform. Starting makes the piece live. */
export async function setAdRunning(db: Database, workspaceId: string, launchId: string, running: boolean, options: { env?: Env; now?: Date } = {}): Promise<AdLaunch> {
  const launch = await db.query.adLaunches.findFirst({ where: and(eq(adLaunches.id, launchId), eq(adLaunches.workspaceId, workspaceId)) });
  if (!launch) throw new CampaignError((m) => m.pieceNotFound);
  if (running && launch.endsOn < todayOf(options.now ?? new Date())) throw new CampaignError((m) => m.adEnded);
  const account = await db.query.adAccounts.findFirst({ where: eq(adAccounts.id, launch.adAccountId) });
  if (!account) throw new CampaignError((m) => m.adAccount);
  try {
    await withAccount(db, account, (platform, access) => platform.setRunning(access, launch.externalId, running), options.env);
  } catch (error) {
    await db.update(adLaunches).set({ error: error instanceof Error ? error.message.slice(0, 500) : String(error), updatedAt: new Date() }).where(eq(adLaunches.id, launch.id));
    throw error;
  }
  const [row] = await db.update(adLaunches).set({ status: running ? 'running' : 'paused', error: null, updatedAt: new Date() }).where(eq(adLaunches.id, launch.id)).returning();
  if (running) await db.update(pieces).set({ status: 'live', updatedAt: new Date() }).where(and(eq(pieces.id, launch.pieceId), eq(pieces.status, 'approved')));
  return row!;
}

export interface AdLaunchView extends AdLaunch {
  account: { name: string; platform: AdPlatformId; status: string };
}

export async function getAdLaunch(db: Database, workspaceId: string, pieceId: string): Promise<AdLaunchView | null> {
  const [row] = await db
    .select({ launch: adLaunches, account: { name: adAccounts.name, platform: adAccounts.platform, status: adAccounts.status } })
    .from(adLaunches)
    .innerJoin(adAccounts, eq(adAccounts.id, adLaunches.adAccountId))
    .where(and(eq(adLaunches.pieceId, pieceId), eq(adLaunches.workspaceId, workspaceId)));
  return row ? { ...row.launch, account: row.account } : null;
}

// ------------------------------------------------------------------ numbers

const SYNC_EVERY_MS = 60 * 60_000;
/** Platforms correct numbers for a few days; keep reading a while after the end. */
const LATE_DAYS = 3;

/** Reads the numbers of launched ads into their campaigns' results (one row per channel and day). */
export async function syncAdStats(db: Database, options: { env?: Env; now?: Date; limit?: number } = {}): Promise<number> {
  const now = options.now ?? new Date();
  const today = todayOf(now);
  const lateCutoff = todayOf(new Date(now.getTime() - LATE_DAYS * 86_400_000));
  const due = await db
    .select()
    .from(adLaunches)
    .where(
      and(
        lte(adLaunches.startsOn, today),
        or(inArray(adLaunches.status, ['running', 'paused']), sql`${adLaunches.endsOn} >= ${lateCutoff}`),
        or(isNull(adLaunches.syncedAt), lt(adLaunches.syncedAt, new Date(now.getTime() - SYNC_EVERY_MS))),
      ),
    )
    .limit(options.limit ?? 20);
  let synced = 0;
  for (const launch of due) {
    const account = await db.query.adAccounts.findFirst({ where: eq(adAccounts.id, launch.adAccountId) });
    const piece = await db.query.pieces.findFirst({ where: eq(pieces.id, launch.pieceId) });
    const campaign = piece && (await db.query.campaigns.findFirst({ where: eq(campaigns.id, piece.campaignId) }));
    if (!account || !piece || !campaign) continue;
    const to = launch.endsOn < today ? launch.endsOn : today;
    try {
      const days = await withAccount(db, account, (platform, access) => platform.stats(access, launch.externalId, launch.startsOn, to), options.env);
      const source = `ads:${launch.id}`;
      const sameCurrency = launch.currency === campaign.currency;
      await db.transaction(async (tx) => {
        await tx.delete(campaignResults).where(and(eq(campaignResults.campaignId, campaign.id), eq(campaignResults.source, source)));
        const rows = days
          .filter((day) => day.impressions || day.clicks || day.costMinor || day.conversions)
          .map((day) => ({
            workspaceId: launch.workspaceId,
            campaignId: campaign.id,
            channel: pieceChannel('ad', piece.format),
            day: day.day,
            reach: day.impressions,
            clicks: day.clicks,
            leads: day.conversions,
            spendCents: sameCurrency ? day.costMinor : 0,
            revenueCents: sameCurrency ? day.conversionValueMinor : 0,
            note: `${piece.title}${sameCurrency ? '' : ` (${(day.costMinor / 100).toFixed(2)} ${launch.currency})`}`.slice(0, 500),
            source,
          }));
        if (rows.length > 0) await tx.insert(campaignResults).values(rows);
      });
      await db
        .update(adLaunches)
        .set({ syncedAt: now, error: null, ...(launch.endsOn < today && launch.status !== 'ended' && { status: 'ended' as const }), updatedAt: now })
        .where(eq(adLaunches.id, launch.id));
      synced++;
    } catch (error) {
      await db.update(adLaunches).set({ syncedAt: now, error: error instanceof Error ? error.message.slice(0, 500) : String(error), updatedAt: now }).where(eq(adLaunches.id, launch.id));
    }
  }
  return synced;
}
