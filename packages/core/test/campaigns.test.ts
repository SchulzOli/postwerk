import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, media, pieces, users, workspaces, type Campaign, type CampaignResult, type Database } from '@maas/db';
import { runMigrations } from '../../db/src/migrate';
import { saveAccount } from '../src/accounts';
import {
  addResult,
  cleanCampaign,
  createCampaign,
  createPiece,
  deleteCampaign,
  getCampaign,
  listCampaigns,
  savePiece,
  setPieceStatus,
  summarizeCampaign,
  updateCampaign,
  type CampaignInput,
  type ResultInput,
} from '../src/campaigns';
import { errorText } from '../src/i18n';
import { emptyContent, formatMoney, parseMoney, pieceChannel } from '../src/marketing';
import { cleanupUnusedMedia } from '../src/media';
import { createPost } from '../src/posts';

const input = (overrides: Partial<CampaignInput> = {}): CampaignInput => ({
  name: 'Rückenwochen',
  goal: 'leads',
  status: 'planned',
  audience: 'Büroarbeiter in Berlin',
  message: 'Rudi hilft deinem Rücken',
  startsOn: '2026-11-02',
  endsOn: '2026-11-29',
  currency: 'EUR',
  budgetCents: 150_000,
  channels: [
    { channel: 'print', budgetCents: 40_000 },
    { channel: 'social', budgetCents: 0 },
    { channel: 'search_ads', budgetCents: 60_000 },
  ],
  notes: '',
  ...overrides,
});

const fail = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return [errorText(error, 'en'), errorText(error, 'de')];
  }
  throw new Error('expected an error');
};

describe('campaign checks', () => {
  it('cleans a campaign and orders its channels', () => {
    const campaign = cleanCampaign(input({ name: '  Rückenwochen ', goal: 'fame' as never, channels: [...input().channels, { channel: 'print', budgetCents: 5 }] }));
    expect(campaign.name).toBe('Rückenwochen');
    expect(campaign.goal).toBe('awareness');
    expect(campaign.channels.map((c) => c.channel)).toEqual(['social', 'search_ads', 'print']);
  });

  it('says what to fix, in the person’s language', () => {
    expect(fail(() => cleanCampaign(input({ name: ' ' })))).toEqual(['Please give the campaign a name.', 'Bitte gib der Kampagne einen Namen.']);
    expect(fail(() => cleanCampaign(input({ endsOn: '2026-10-01' })))[0]).toBe('The campaign ends before it starts.');
    expect(fail(() => cleanCampaign(input({ startsOn: '2.11.2026' })))[1]).toBe('Bitte gib Daten als JJJJ-MM-TT ein.');
    expect(fail(() => cleanCampaign(input({ budgetCents: -1 })))[0]).toMatch(/0 or more/);
    expect(fail(() => cleanCampaign(input({ budgetCents: 3_000_000_000 })))[0]).toMatch(/0 or more/);
    expect(fail(() => cleanCampaign(input({ currency: 'DOGE' })))[0]).toBe('Unknown currency.');
    expect(fail(() => cleanCampaign(input({ channels: [{ channel: 'billboard', budgetCents: 0 }] })))[0]).toBe('Unknown channel.');
  });

  it('reads amounts the way people type them', () => {
    expect(parseMoney('1.234,50')).toBe(123_450);
    expect(parseMoney('1,234.50')).toBe(123_450);
    expect(parseMoney('1234.5')).toBe(123_450);
    expect(parseMoney('1.500')).toBe(150_000);
    expect(parseMoney("12'000")).toBe(1_200_000);
    expect(parseMoney('')).toBe(0);
    expect(parseMoney('zehn')).toBeNull();
    expect(parseMoney('-5')).toBeNull();
    expect(formatMoney(150_000, 'EUR', 'de').replace(/\s/g, ' ')).toBe('1.500 €');
    expect(formatMoney(123_450, 'EUR', 'en')).toBe('€1,234.50');
  });

  it('knows where each piece runs and how it starts', () => {
    expect(pieceChannel('ad', 'search')).toBe('search_ads');
    expect(pieceChannel('ad', 'video')).toBe('video_ads');
    expect(pieceChannel('print', 'postcard_a6')).toBe('mail');
    expect(pieceChannel('print', 'poster_a2')).toBe('outdoor');
    expect(pieceChannel('spot', 'radio_30')).toBe('radio');
    const spot = emptyContent('spot', 'video_15') as { scenes: { seconds: number }[] };
    expect(spot.scenes.reduce((total, scene) => total + scene.seconds, 0)).toBe(15);
    expect(emptyContent('print', 'newspaper')).toMatchObject({ widthMm: 90, heightMm: 120, showCharacter: true });
  });

  it('sets the plan against the results', () => {
    const result = (channel: string, numbers: Partial<CampaignResult>) => ({ channel, spendCents: 0, reach: 0, clicks: 0, leads: 0, sales: 0, revenueCents: 0, ...numbers }) as CampaignResult;
    const campaign = cleanCampaign(input()) as Pick<Campaign, 'budgetCents' | 'channels'>;
    const summary = summarizeCampaign(
      campaign,
      [result('search_ads', { spendCents: 20_000, clicks: 400, leads: 8, revenueCents: 80_000 }), result('search_ads', { spendCents: 10_000, leads: 2 }), result('radio', { spendCents: 5_000, reach: 30_000 })],
      [{ kind: 'spot', format: 'tv_30' }],
    );
    expect(summary.channels.map((c) => c.channel)).toEqual(['social', 'search_ads', 'print', 'radio', 'tv']);
    expect(summary.channels.find((c) => c.channel === 'search_ads')).toMatchObject({ plannedCents: 60_000, spendCents: 30_000, leads: 10, costPerLeadCents: 3_000 });
    expect(summary.channels.find((c) => c.channel === 'search_ads')!.roas).toBeCloseTo(80_000 / 30_000);
    expect(summary.channels.find((c) => c.channel === 'radio')).toMatchObject({ plannedCents: 0, costPerLeadCents: null });
    expect(summary.total).toMatchObject({ plannedCents: 100_000, spendCents: 35_000, reach: 30_000, leads: 10 });
    expect(summary.unplannedCents).toBe(50_000);
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('campaign storage (Postgres)', () => {
  let db: Database;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let userId: string;

  beforeAll(async () => {
    await runMigrations(url);
    db = createDb(url);
  });
  afterAll(async () => db?.close());
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE workspaces, users CASCADE`);
    const [user] = await db.insert(users).values({ email: 'a@example.com', name: 'A', passwordHash: 'x' }).returning();
    const [workspace, other] = await db.insert(workspaces).values([{ name: 'Praxis' }, { name: 'Other' }]).returning();
    userId = user!.id;
    workspaceId = workspace!.id;
    otherWorkspaceId = other!.id;
  });

  const result = (overrides: Partial<ResultInput> = {}): ResultInput => ({ channel: 'print', day: '2026-11-05', reach: 2000, clicks: 0, leads: 3, sales: 1, revenueCents: 9_000, spendCents: 40_000, note: '', ...overrides });

  it('keeps campaigns with their pieces, posts and results', async () => {
    const campaign = await createCampaign(db, workspaceId, userId, input());
    const flyer = await createPiece(db, workspaceId, campaign.id, { kind: 'print', format: 'flyer_a5', title: 'Flyer Wartezimmer' });
    expect(flyer).toMatchObject({ status: 'draft', source: 'manual', content: { showCharacter: true } });
    await addResult(db, workspaceId, campaign.id, userId, result());

    const account = await saveAccount(db, { workspaceId, provider: 'sandbox', profile: { externalId: 'one', handle: '@one' }, credentials: {} });
    const post = await createPost(db, { workspaceId, authorId: userId, text: 'Rudi sagt hallo', accountIds: [account.id], scheduledAt: null, draft: true, campaignId: campaign.id });
    expect(post.ok).toBe(true);

    const [listed] = await listCampaigns(db, workspaceId);
    expect(listed).toMatchObject({ name: 'Rückenwochen', pieceCount: 1, postCount: 1, spendCents: 40_000 });
    const detail = await getCampaign(db, workspaceId, campaign.id);
    expect(detail?.pieces.map((p) => p.title)).toEqual(['Flyer Wartezimmer']);
    expect(detail?.posts.map((p) => p.text)).toEqual(['Rudi sagt hallo']);
    expect(detail?.results.map((r) => r.leads)).toEqual([3]);

    // Deleting the campaign keeps its posts, without it.
    await deleteCampaign(db, workspaceId, campaign.id);
    expect(await db.select().from(pieces)).toEqual([]);
    const [kept] = await db.execute<{ campaign_id: string | null }>(sql`SELECT campaign_id FROM posts`);
    expect(kept).toEqual({ campaign_id: null });
  });

  it('stays inside its workspace', async () => {
    const campaign = await createCampaign(db, workspaceId, userId, input());
    expect(await getCampaign(db, otherWorkspaceId, campaign.id)).toBeNull();
    expect(await listCampaigns(db, otherWorkspaceId)).toEqual([]);
    await expect(updateCampaign(db, otherWorkspaceId, campaign.id, input({ name: 'Taken' }))).rejects.toThrow(/no longer exists/);
    await expect(createPiece(db, otherWorkspaceId, campaign.id, { kind: 'ad', format: 'search', title: 'Ad' })).rejects.toThrow(/no longer exists/);
    await expect(addResult(db, otherWorkspaceId, campaign.id, userId, result())).rejects.toThrow(/no longer exists/);
    expect(await deleteCampaign(db, otherWorkspaceId, campaign.id)).toBeUndefined();

    const account = await saveAccount(db, { workspaceId: otherWorkspaceId, provider: 'sandbox', profile: { externalId: 'x', handle: '@x' }, credentials: {} });
    const post = await createPost(db, { workspaceId: otherWorkspaceId, authorId: userId, text: 'Hi', accountIds: [account.id], scheduledAt: null, campaignId: campaign.id });
    expect(post).toEqual({ ok: false, errors: ['The selected campaign no longer exists.'] });
  });

  it('approves pieces and sends edited ones back to draft', async () => {
    const campaign = await createCampaign(db, workspaceId, userId, input());
    const ad = await createPiece(db, workspaceId, campaign.id, { kind: 'ad', format: 'search', title: 'Suchanzeige' });
    await expect(createPiece(db, workspaceId, campaign.id, { kind: 'ad', format: 'billboard', title: 'X' })).rejects.toThrow(/Unknown format/);
    await expect(setPieceStatus(db, workspaceId, ad.id, 'live', userId)).rejects.toThrow(/Approve the piece first/);
    const approved = await setPieceStatus(db, workspaceId, ad.id, 'approved', userId);
    expect(approved).toMatchObject({ status: 'approved', approvedBy: userId });
    const edited = await savePiece(db, workspaceId, ad.id, { title: 'Suchanzeige', content: { headlines: ['Rücken?'] }, mediaIds: [] });
    expect(edited).toMatchObject({ status: 'draft', approvedBy: null, approvedAt: null });
  });

  it('keeps the uploads pieces use when unused uploads are cleaned up', async () => {
    const campaign = await createCampaign(db, workspaceId, userId, input());
    const piece = await createPiece(db, workspaceId, campaign.id, { kind: 'print', format: 'flyer_a6', title: 'Flyer' });
    const upload = async () =>
      (await db.insert(media).values({ workspaceId, key: `${workspaceId}/${crypto.randomUUID()}.png`, kind: 'image', mimeType: 'image/png', size: 10, createdAt: new Date(Date.now() - 2 * 86_400_000) }).returning())[0]!;
    const [used, stray] = [await upload(), await upload()];
    await savePiece(db, workspaceId, piece.id, { title: 'Flyer', content: { imageMediaId: used.id }, mediaIds: [used.id] });
    const deleted: string[] = [];
    await cleanupUnusedMedia(db, { delete: async (key: string) => void deleted.push(key) } as never);
    expect(deleted).toEqual([stray.key]);
  });
});
