import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { adAccounts, campaignResults, createDb, pieces, users, workspaces, type Database } from '@maas/db';
import { runMigrations } from '../../db/src/migrate';
import { getAdLaunch, launchAd, removeAdAccount, saveAdAccounts, setAdRunning, syncAdStats, type LaunchInput } from '../src/ads';
import { cleanAdContent, createCampaign, createPiece, saveAdPiece, setPieceStatus } from '../src/campaigns';
import { errorText } from '../src/i18n';
import { adProblems, emptyContent, type AdContent } from '../src/marketing';

const fail = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return errorText(error, 'en');
  }
  return 'no error';
};

const searchAd = (overrides: Partial<AdContent> = {}): AdContent => ({
  headlines: ['Rückenschmerzen?', 'Physio in Berlin', 'Termin online buchen'],
  descriptions: ['Kurze Übungen fürs Büro.', 'Kostenlose Haltungsanalyse.'],
  finalUrl: 'https://praxis.example/termin',
  callToAction: '',
  path1: 'ruecken',
  path2: 'termin',
  keywords: ['physiotherapie berlin', 'Physiotherapie Berlin', ' rückenschmerzen '],
  ...overrides,
});

describe('ad texts', () => {
  it('keeps to the platform limits', () => {
    expect(cleanAdContent('search', searchAd()).keywords).toEqual(['physiotherapie berlin', 'rückenschmerzen']);
    expect(fail(() => cleanAdContent('search', searchAd({ headlines: ['Viel zu lang für eine Überschrift bei Google'] })))).toMatch(/longer than 30/);
    expect(fail(() => cleanAdContent('search', searchAd({ path1: 'zwei wörter' })))).toMatch(/display path/);
    expect(fail(() => cleanAdContent('search', searchAd({ descriptions: ['a', 'b', 'c', 'd', 'e'] })))).toMatch(/at most 4/);
    expect(fail(() => cleanAdContent('social', { ...searchAd(), finalUrl: 'praxis.example' }))).toMatch(/https:\/\//);
    expect(cleanAdContent('social', { headlines: ['Rudi hilft'], descriptions: ['Text'], finalUrl: '', callToAction: 'BUY_A_PONY' }).callToAction).toBe('LEARN_MORE');
    expect(cleanAdContent('video', { headlines: ['Rudi'], descriptions: ['x'], finalUrl: '', callToAction: '', youtubeVideoId: 'https://youtu.be/dQw4w9WgXcQ' }).youtubeVideoId).toBe('dQw4w9WgXcQ');
  });

  it('says what an ad still lacks', () => {
    expect(adProblems('search', emptyContent('ad', 'search') as AdContent)).toEqual([
      { code: 'headlines', min: 3 },
      { code: 'descriptions', min: 2 },
      { code: 'finalUrl' },
      { code: 'keywords' },
    ]);
    expect(adProblems('search', searchAd())).toEqual([]);
    expect(adProblems('social', { headlines: ['x'], descriptions: ['y'], finalUrl: 'https://a.example', callToAction: 'LEARN_MORE' })).toEqual([{ code: 'image' }]);
    expect(adProblems('video', { headlines: ['x'], longHeadlines: ['y'], descriptions: ['z'], finalUrl: 'https://a.example', callToAction: '' })).toEqual([{ code: 'video' }]);
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('ad campaigns (Postgres)', () => {
  let db: Database;
  let workspace: { id: string; name: string };
  let userId: string;
  const env = { GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret', GOOGLE_ADS_DEVELOPER_TOKEN: 'dev', ENCRYPTION_KEY: process.env.ENCRYPTION_KEY };
  const now = new Date('2099-11-10T12:00:00Z');
  const calls: { method: string; url: string; body: unknown }[] = [];
  let stats: unknown[] = [];

  beforeAll(async () => {
    await runMigrations(url);
    db = createDb(url);
  });
  afterAll(async () => db?.close());
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE workspaces, users CASCADE`);
    const [user] = await db.insert(users).values({ email: 'a@example.com', name: 'A', passwordHash: 'x' }).returning();
    const [row] = await db.insert(workspaces).values({ name: 'Praxis' }).returning();
    userId = user!.id;
    workspace = { id: row!.id, name: row!.name };
    calls.length = 0;
    stats = [];
    // A stand-in for Google's token endpoint and the Google Ads API.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
        const target = String(input);
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : undefined;
        calls.push({ method: init.method ?? 'GET', url: target, body });
        if (target === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'fresh', expires_in: 3600 });
        if (target.endsWith('googleAds:mutate')) return Response.json({ mutateOperationResponses: [{ campaignResult: { resourceName: 'customers/123/campaigns/777' } }] });
        if (target.endsWith('googleAds:search')) return Response.json({ results: stats });
        return Response.json({ error: { message: `no mock for ${target}` } }, { status: 404 });
      }),
    );
  });

  async function readyAd(currency = 'EUR') {
    const campaign = await createCampaign(db, workspace.id, userId, {
      name: 'Rückenwochen',
      goal: 'leads',
      status: 'running',
      audience: '',
      message: '',
      startsOn: '2099-11-01',
      endsOn: '2099-11-30',
      currency,
      budgetCents: 100_000,
      channels: [{ channel: 'search_ads', budgetCents: 60_000 }],
      notes: '',
    });
    const piece = await createPiece(db, workspace.id, campaign.id, { kind: 'ad', format: 'search', title: 'Suchanzeige' });
    await saveAdPiece(db, workspace.id, piece.id, { title: 'Suchanzeige', content: searchAd() });
    const [account] = await saveAdAccounts(db, workspace.id, 'google_ads', [{ id: '123', name: 'Praxis Ads', currency: 'EUR' }], { refreshToken: 'refresh' }, userId);
    return { campaign, piece, account: account! };
  }
  const input = (adAccountId: string, overrides: Partial<LaunchInput> = {}): LaunchInput => ({ adAccountId, budgetCents: 60_000, startsOn: '2099-11-01', endsOn: '2099-11-30', countries: ['DE'], language: 'de', ...overrides });

  it('launches only approved, complete ads in an account of the right platform', async () => {
    const { piece, account } = await readyAd();
    await expect(launchAd(db, workspace, userId, piece.id, input(account.id), { env, now })).rejects.toThrow(/Approve the piece first/);
    await setPieceStatus(db, workspace.id, piece.id, 'approved', userId);
    await expect(launchAd(db, workspace, userId, piece.id, input(account.id, { countries: [] }), { env, now })).rejects.toThrow(/at least one country/);
    await expect(launchAd(db, workspace, userId, piece.id, input(account.id, { endsOn: '2099-11-09' }), { env, now })).rejects.toThrow(/end cannot be in the past/);
    await expect(launchAd(db, workspace, userId, piece.id, input(account.id, { budgetCents: 50 }), { env, now })).rejects.toThrow(/0 or more/);

    const launch = await launchAd(db, workspace, userId, piece.id, input(account.id), { env, now });
    expect(launch).toMatchObject({ externalId: '777', status: 'paused', budgetCents: 60_000, currency: 'EUR', startsOn: '2099-11-10', endsOn: '2099-11-30' });
    // The token was renewed first, then the campaign built: 600 € over the 21 days left, as a daily budget.
    expect(calls.map((call) => call.url.replace(/^https:\/\/[^/]+/, ''))).toEqual(['/token', '/v25/customers/123/googleAds:mutate']);
    const operations = (calls[1]!.body as { mutateOperations: { campaignBudgetOperation?: { create: { amountMicros: string } } }[] }).mutateOperations;
    expect(operations[0]!.campaignBudgetOperation!.create.amountMicros).toBe(String(Math.floor(60_000 / 21) * 10_000));
    await expect(launchAd(db, workspace, userId, piece.id, input(account.id), { env, now })).rejects.toThrow(/already runs/);
    expect(await getAdLaunch(db, workspace.id, piece.id)).toMatchObject({ account: { name: 'Praxis Ads', platform: 'google_ads' } });
  });

  it('starts and pauses, and keeps the account while a campaign runs', async () => {
    const { piece, account } = await readyAd();
    await setPieceStatus(db, workspace.id, piece.id, 'approved', userId);
    const launch = await launchAd(db, workspace, userId, piece.id, input(account.id), { env, now });
    await setAdRunning(db, workspace.id, launch.id, true, { env, now });
    expect((await db.query.pieces.findFirst({ where: eq(pieces.id, piece.id) }))?.status).toBe('live');
    await expect(removeAdAccount(db, workspace.id, account.id)).rejects.toThrow(/Pause it first/);
    expect((await setAdRunning(db, workspace.id, launch.id, false, { env, now })).status).toBe('paused');
    expect(await removeAdAccount(db, workspace.id, account.id)).toMatchObject({ name: 'Praxis Ads' });
  });

  it('reads the numbers into the campaign results and replaces them on the next read', async () => {
    const { campaign, piece, account } = await readyAd();
    await setPieceStatus(db, workspace.id, piece.id, 'approved', userId);
    const launch = await launchAd(db, workspace, userId, piece.id, input(account.id), { env, now });
    stats = [
      { segments: { date: '2099-11-10' }, metrics: { impressions: '1000', clicks: '30', costMicros: '12500000', conversions: 2, conversionsValue: 0 } },
      { segments: { date: '2099-11-11' }, metrics: { impressions: '0', clicks: '0', costMicros: '0' } },
    ];
    expect(await syncAdStats(db, { env, now })).toBe(1);
    const rows = async () => db.select().from(campaignResults).where(eq(campaignResults.campaignId, campaign.id));
    expect(await rows()).toEqual([expect.objectContaining({ channel: 'search_ads', day: '2099-11-10', reach: 1000, clicks: 30, leads: 2, spendCents: 1250, source: `ads:${launch.id}` })]);
    // Synced within the hour: nothing to do.
    expect(await syncAdStats(db, { env, now })).toBe(0);
    stats = [{ segments: { date: '2099-11-10' }, metrics: { impressions: '1500', clicks: '40', costMicros: '15000000', conversions: 3 } }];
    expect(await syncAdStats(db, { env, now: new Date(now.getTime() + 2 * 60 * 60_000) })).toBe(1);
    expect(await rows()).toEqual([expect.objectContaining({ reach: 1500, spendCents: 1500, leads: 3 })]);
    // After the end date the campaign counts as ended.
    await syncAdStats(db, { env, now: new Date('2099-12-01T12:00:00Z') });
    expect((await getAdLaunch(db, workspace.id, piece.id))?.status).toBe('ended');
  });

  it('keeps spend in another currency out of the totals', async () => {
    const { campaign, piece, account } = await readyAd('CHF');
    await setPieceStatus(db, workspace.id, piece.id, 'approved', userId);
    await launchAd(db, workspace, userId, piece.id, input(account.id), { env, now });
    stats = [{ segments: { date: '2099-11-10' }, metrics: { impressions: '10', clicks: '1', costMicros: '2000000' } }];
    await syncAdStats(db, { env, now });
    const [row] = await db.select().from(campaignResults).where(eq(campaignResults.campaignId, campaign.id));
    expect(row).toMatchObject({ spendCents: 0, note: 'Suchanzeige (2.00 EUR)' });
  });

  it('marks the account for reconnecting when Google revoked access', async () => {
    const { piece, account } = await readyAd();
    await setPieceStatus(db, workspace.id, piece.id, 'approved', userId);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, { status: 400 })));
    await expect(launchAd(db, workspace, userId, piece.id, input(account.id), { env, now })).rejects.toThrow(/expired or revoked/);
    expect((await db.query.adAccounts.findFirst({ where: eq(adAccounts.id, account.id) }))?.status).toBe('needs_reauth');
  });
});
