import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { campaigns, createDb, media, users, workspaces, type Database } from '@maas/db';
import { runMigrations } from '../../db/src/migrate';
import { createCampaign, createPiece, getCampaign, saveListingPiece, saveScreenshotPiece, setPieceStatus, updateCampaign, type CampaignInput } from '../src/campaigns';
import { createCampaignFromTemplate } from '../src/templates';
import { errorText } from '../src/i18n';
import { builtinMarket } from '../src/market';
import { pieceChannel, screenshotProblems } from '../src/marketing';
import { installBuiltinMarket, uninstallMarket } from '../src/plugins';
import { checkListing, cleanProduct, createProduct, deleteProduct, listProducts, productProblems, updateProduct } from '../src/products';

const market = builtinMarket('business-central')!;
const profile = { does: 'Books deposits on crates and bottles.', publisher: 'Example Apps GmbH', app_version: '2.4.0.0', editions: ['essentials', 'premium'] };

describe('cleanProduct', () => {
  it('keeps common and market fields, drops unknown ones, and lists features one per line', () => {
    const product = cleanProduct(market, { name: ' Deposit Tracker ', profile: { ...profile, features: 'Deposit lines\n\n Statements ', unknown: 'x', editions: 'premium' } });
    expect(product).toEqual({ name: 'Deposit Tracker', profile: { does: profile.does, features: ['Deposit lines', 'Statements'], publisher: 'Example Apps GmbH', app_version: '2.4.0.0', editions: ['premium'] } });
  });

  it('explains what to fix, in both languages', () => {
    const fail = (input: Parameters<typeof cleanProduct>[1]) => {
      try {
        cleanProduct(market, input);
      } catch (error) {
        return [errorText(error, 'en'), errorText(error, 'de')];
      }
      throw new Error('accepted');
    };
    expect(fail({ name: ' ', profile: {} })[0]).toMatch(/name/);
    expect(fail({ name: 'A', profile: { editions: ['business'] } })).toEqual([expect.stringMatching(/editions/), expect.stringMatching(/editions/)]);
    expect(fail({ name: 'A', profile: { does: 'x'.repeat(601) } })[0]).toMatch(/at most 600/);
    expect(fail({ name: 'A', profile: { features: Array.from({ length: 9 }, (_, i) => `f${i}`) } })[0]).toMatch(/at most 8/);
  });

  it('lists what a listing still needs from the profile', () => {
    expect(productProblems(market, { profile: {} })).toEqual(['does', 'publisher', 'app_version', 'editions']);
    expect(productProblems(market, { profile })).toEqual([]);
  });
});

describe('screenshots and the marketplace channel', () => {
  it('need a capture and a caption, and count for the marketplace', () => {
    expect(screenshotProblems({ captureMediaId: null, headline: '', caption: ' ', background: 'gradient' })).toEqual(['capture', 'caption']);
    expect(pieceChannel('listing', 'listing')).toBe('marketplace');
    expect(pieceChannel('screenshot', 'screenshot')).toBe('marketplace');
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('products and listings (Postgres)', () => {
  let db: Database;
  let workspaceId: string;
  let userId: string;

  const campaignInput = (patch: Partial<CampaignInput> = {}): CampaignInput => ({
    name: 'Launch',
    goal: 'leads',
    status: 'planned',
    audience: '',
    message: '',
    startsOn: null,
    endsOn: null,
    currency: 'EUR',
    budgetCents: 0,
    channels: [],
    notes: '',
    ...patch,
  });

  beforeAll(async () => {
    await runMigrations(url);
    db = createDb(url);
  });

  afterAll(async () => db?.close());

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE users, workspaces, mastodon_apps CASCADE`);
    const [user] = await db.insert(users).values({ email: 'a@example.com', name: 'A', passwordHash: 'x' }).returning();
    const [workspace] = await db.insert(workspaces).values({ name: 'Test' }).returning();
    userId = user!.id;
    workspaceId = workspace!.id;
  });

  it('needs the market installed, and keeps products per workspace', async () => {
    await expect(createProduct(db, workspaceId, 'business-central', { name: 'Deposit Tracker', profile })).rejects.toThrow(/Install the product’s target market/);
    await installBuiltinMarket(db, workspaceId, 'business-central');
    const product = await createProduct(db, workspaceId, 'business-central', { name: 'Deposit Tracker', profile });
    await createProduct(db, workspaceId, 'business-central', { name: 'Pallet Pool', profile: {} });
    expect((await listProducts(db, workspaceId)).map((entry) => entry.name)).toEqual(['Deposit Tracker', 'Pallet Pool']);

    const [other] = await db.insert(workspaces).values({ name: 'Other' }).returning();
    expect(await listProducts(db, other!.id)).toEqual([]);
    await expect(updateProduct(db, other!.id, product.id, { name: 'Taken', profile: {} })).rejects.toThrow(/no longer exists/);
    const updated = await updateProduct(db, workspaceId, product.id, { name: 'Deposit Tracker 2', profile });
    expect(updated.name).toBe('Deposit Tracker 2');
  });

  it('links campaigns only to the workspace’s own products, and unlinks them when a product is deleted', async () => {
    await installBuiltinMarket(db, workspaceId, 'business-central');
    const product = await createProduct(db, workspaceId, 'business-central', { name: 'Deposit Tracker', profile });
    const [other] = await db.insert(workspaces).values({ name: 'Other' }).returning();
    await installBuiltinMarket(db, other!.id, 'business-central');
    const foreign = await createProduct(db, other!.id, 'business-central', { name: 'Not yours', profile });

    await expect(createCampaign(db, workspaceId, userId, campaignInput({ productId: foreign.id }))).rejects.toThrow(/does not exist in this workspace/);
    const campaign = await createCampaign(db, workspaceId, userId, campaignInput({ productId: product.id }));
    expect(campaign.productId).toBe(product.id);
    // Leaving the product out of an update keeps it.
    expect((await updateCampaign(db, workspaceId, campaign.id, campaignInput({ name: 'Launch 2' }))).productId).toBe(product.id);

    await deleteProduct(db, workspaceId, product.id);
    const [row] = await db.select().from(campaigns);
    expect(row!.productId).toBeNull();
  });

  it('adds listings and screenshots only to campaigns with a product', async () => {
    const campaign = await createCampaign(db, workspaceId, userId, campaignInput());
    await expect(createPiece(db, workspaceId, campaign.id, { kind: 'listing', format: 'listing', title: 'Listing' })).rejects.toThrow(/belong to a product/);
  });

  it('approves a listing only when the market’s checks pass', async () => {
    await installBuiltinMarket(db, workspaceId, 'business-central');
    const product = await createProduct(db, workspaceId, 'business-central', { name: 'Deposit Tracker', profile: {} });
    const campaign = await createCampaign(db, workspaceId, userId, campaignInput({ productId: product.id }));
    const listing = await createPiece(db, workspaceId, campaign.id, { kind: 'listing', format: 'listing', title: 'AppSource listing' });

    const before = await checkListing(db, workspaceId, listing);
    expect(before!.listing.map((problem) => problem.code === 'required' ? problem.field : problem.code === 'count' ? problem.field : problem.code)).toEqual(['name', 'summary', 'description', 'screenshots', 'documents']);
    expect(before!.profile).toEqual(['does', 'publisher', 'app_version', 'editions']);
    await expect(setPieceStatus(db, workspaceId, listing.id, 'approved', userId)).rejects.toThrow(/not ready yet/);

    await updateProduct(db, workspaceId, product.id, { name: 'Deposit Tracker', profile });
    const saved = await saveListingPiece(db, workspaceId, listing.id, {
      title: 'AppSource listing',
      content: {
        texts: { name: 'Deposit Tracker', summary: 'Deposits, booked by themselves.', description: 'Books deposits in Microsoft Dynamics 365 Business Central.', unknown_FIELD: 'dropped' },
        keywords: ['deposit', 'deposit', ' '],
        videos: [],
        documents: [{ name: 'Brochure.pdf', url: 'https://example.com/brochure.pdf' }],
      },
    });
    expect(saved.content).toMatchObject({ keywords: ['deposit'], texts: { name: 'Deposit Tracker' } });
    expect((saved.content as { texts: Record<string, string> }).texts).not.toHaveProperty('unknown_FIELD');
    await expect(saveListingPiece(db, workspaceId, listing.id, { title: 'x', content: { texts: {}, keywords: [], videos: [{ name: 'Demo', url: 'not a link' }], documents: [] } })).rejects.toThrow(/not a web address/);

    // Three screenshots with captions make it complete.
    const [image] = await db.insert(media).values({ workspaceId, key: `${workspaceId}/a.png`, kind: 'image', mimeType: 'image/png', size: 10 }).returning();
    for (const caption of ['Deposit lines on an order', 'Statements', 'Returns']) {
      const shot = await createPiece(db, workspaceId, campaign.id, { kind: 'screenshot', format: 'screenshot', title: caption });
      await expect(setPieceStatus(db, workspaceId, shot.id, 'approved', userId)).rejects.toThrow(/capture and a caption/);
      await saveScreenshotPiece(db, workspaceId, shot.id, { title: caption, content: { captureMediaId: image!.id, headline: 'Deposits book themselves', caption, background: 'dark' } });
      await setPieceStatus(db, workspaceId, shot.id, 'approved', userId);
    }
    expect((await checkListing(db, workspaceId, saved))!.listing).toEqual([]);
    expect((await setPieceStatus(db, workspaceId, listing.id, 'approved', userId)).status).toBe('approved');

    // Without its market a listing cannot be approved again.
    await setPieceStatus(db, workspaceId, listing.id, 'draft', userId);
    await uninstallMarket(db, workspaceId, 'business-central');
    await expect(setPieceStatus(db, workspaceId, listing.id, 'approved', userId)).rejects.toThrow(/not installed/);
  });

  it('only takes the workspace’s own images as captures', async () => {
    await installBuiltinMarket(db, workspaceId, 'business-central');
    const product = await createProduct(db, workspaceId, 'business-central', { name: 'Deposit Tracker', profile });
    const campaign = await createCampaign(db, workspaceId, userId, campaignInput({ productId: product.id }));
    const shot = await createPiece(db, workspaceId, campaign.id, { kind: 'screenshot', format: 'screenshot', title: 'Shot' });
    const [other] = await db.insert(workspaces).values({ name: 'Other' }).returning();
    const [foreign] = await db.insert(media).values({ workspaceId: other!.id, key: `${other!.id}/a.png`, kind: 'image', mimeType: 'image/png', size: 10 }).returning();
    await expect(saveScreenshotPiece(db, workspaceId, shot.id, { title: 'Shot', content: { captureMediaId: foreign!.id, headline: '', caption: 'x', background: 'gradient' } })).rejects.toThrow(/uploaded images/);
    await expect(saveScreenshotPiece(db, workspaceId, shot.id, { title: 'Shot', content: { captureMediaId: null, headline: 'x'.repeat(61), caption: '', background: 'gradient' } })).rejects.toThrow(/longer than 60/);
  });
});

describe.skipIf(!url)('campaigns from a market template (Postgres)', () => {
  let db: Database;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    await runMigrations(url);
    db = createDb(url);
  });
  afterAll(async () => db?.close());
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE users, workspaces, mastodon_apps CASCADE`);
    const [user] = await db.insert(users).values({ email: 'a@example.com', name: 'A', passwordHash: 'x' }).returning();
    const [workspace] = await db.insert(workspaces).values({ name: 'Test' }).returning();
    userId = user!.id;
    workspaceId = workspace!.id;
  });

  const start = (productId: string, templateId = 'launch') => ({ productId, templateId, name: 'Deposit Tracker launch', message: '', startsOn: '2027-01-11', endsOn: '2027-02-07', currency: 'EUR', budgetCents: 120_000 });

  it('sets up goal, channels, the template’s pieces and the planned posts, in the user’s language', async () => {
    await installBuiltinMarket(db, workspaceId, 'business-central');
    const product = await createProduct(db, workspaceId, 'business-central', { name: 'Deposit Tracker', profile });
    const campaign = await createCampaignFromTemplate(db, workspaceId, userId, start(product.id), 'de');
    expect(campaign).toMatchObject({ goal: 'leads', productId: product.id, budgetCents: 120_000, status: 'draft' });
    expect(campaign.channels.map((entry) => entry.channel)).toEqual(['social', 'marketplace', 'search_ads', 'video_ads']);
    expect(campaign.notes).toMatch(/„Start auf AppSource“: 6 Beiträge über 4 Wochen/);
    const detail = await getCampaign(db, workspaceId, campaign.id);
    expect(detail!.pieces.map((piece) => [piece.kind, piece.format, piece.title])).toEqual([
      ['listing', 'listing', 'AppSource-Eintrag'],
      ['screenshot', 'screenshot', 'Screenshot 1'],
      ['screenshot', 'screenshot', 'Screenshot 2'],
      ['screenshot', 'screenshot', 'Screenshot 3'],
      ['spot', 'video_30', 'Demo'],
      ['ad', 'search', 'Suchanzeige'],
    ]);
  });

  it('refuses unknown templates, other workspaces’ products and uninstalled markets', async () => {
    await installBuiltinMarket(db, workspaceId, 'business-central');
    const product = await createProduct(db, workspaceId, 'business-central', { name: 'Deposit Tracker', profile });
    await expect(createCampaignFromTemplate(db, workspaceId, userId, start(product.id, 'nope'), 'en')).rejects.toThrow(/template does not exist/);
    const [other] = await db.insert(workspaces).values({ name: 'Other' }).returning();
    await expect(createCampaignFromTemplate(db, other!.id, userId, start(product.id), 'en')).rejects.toThrow(/does not exist in this workspace/);
    await uninstallMarket(db, workspaceId, 'business-central');
    await expect(createCampaignFromTemplate(db, workspaceId, userId, start(product.id), 'en')).rejects.toThrow(/not installed/);
  });
});
