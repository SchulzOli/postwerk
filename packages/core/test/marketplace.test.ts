import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { campaignResults, createDb, marketplaceConnections, users, workspaces, type Database } from '@maas/db';
import { runMigrations } from '../../db/src/migrate';
import { createCampaign, createPiece, saveListingPiece, setPieceStatus, type CampaignInput } from '../src/campaigns';
import { errorText } from '../src/i18n';
import { campaignForDay, deleteLeads, ensureConnection, listLeads, listingDestination, MARKETPLACE_SOURCES, receiveLead, removeCredentials, saveCredentials, sendListing, syncAllMarketplaces, syncMarketplace } from '../src/marketplace';
import { cleanCredentials, insightsRows, parseCsv, PartnerCenterClient, PartnerCenterError, partnerCenterProductId, type PartnerCenterCredentials } from '../src/partner-center';
import { installBuiltinMarket } from '../src/plugins';
import { createProduct } from '../src/products';

const credentials: PartnerCenterCredentials = { tenantId: 'contoso.onmicrosoft.com', clientId: '11111111-2222-3333-4444-555555555555', clientSecret: 'secret' };
const OFFER = '9f8af57f-ab07-461b-8404-50e10e5e80fb';

/** A stand-in for Microsoft: Entra tokens, the ingestion API and the analytics API, recording every call. */
function fakeMicrosoft(options: { rejectSecret?: boolean; csv?: string | null; jobResult?: string; listing?: Record<string, unknown> | null } = {}) {
  const calls: { method: string; url: string; body?: unknown; auth?: string | null }[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetcher = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const raw = init.body;
    const body = raw instanceof URLSearchParams ? Object.fromEntries(raw) : typeof raw === 'string' ? JSON.parse(raw) : undefined;
    calls.push({ method: init.method ?? 'GET', url, body, auth: new Headers(init.headers).get('authorization') });
    if (url.startsWith('https://login.microsoftonline.com/')) {
      if (options.rejectSecret) return json({ error: 'invalid_client' }, 401);
      return json({ token_type: 'Bearer', expires_in: '3599', access_token: url.includes('/v2.0/') ? 'graph-token' : 'insights-token' });
    }
    if (url.includes('/resource-tree/product/')) {
      if (options.listing === null) return json({ resources: [{ $schema: 'https://schema.mp.microsoft.com/schema/product/2026-09-01-preview1', id: `product/${OFFER}` }] });
      return json({ resources: [{ $schema: 'https://schema.mp.microsoft.com/schema/product/2026-09-01-preview1', id: `product/${OFFER}` }, options.listing ?? { $schema: 'https://schema.mp.microsoft.com/schema/listing/2026-08-01-preview1', id: `listing/${OFFER}/main/en-us`, kind: 'dynamics365BusinessCentral', languageId: 'en-us', title: 'Old', description: 'Old', searchResultSummary: 'Old', keywords: [] }] });
    }
    if (url.includes('/configure?')) return json({ jobId: 'job-1', jobStatus: 'running', jobResult: 'pending', errors: [] });
    if (url.includes('/configure/job-1/status')) return json({ jobId: 'job-1', jobStatus: 'completed', jobResult: options.jobResult ?? 'succeeded', errors: options.jobResult === 'failed' ? [{ code: 'businessValidationError', message: 'The description is too long.' }] : [] });
    if (url.endsWith('/ScheduledReport') && init.method === 'POST') return json({ value: [{ reportId: 'report-1', reportStatus: 'Active' }], statusCode: 200 });
    if (url.includes('/ScheduledReport/execution/report-1')) {
      if (options.csv === null) return json({ value: [{ executionStatus: 'Pending', reportAccessSecureLink: null }] });
      return json({ value: [{ executionStatus: 'Completed', reportAccessSecureLink: 'https://reports.example.blob.core.windows.net/r.csv?sig=x', reportGeneratedTime: '2027-01-14T03:00:00Z' }] });
    }
    if (url.startsWith('https://reports.example.blob.core.windows.net/')) return new Response(options.csv ?? '', { status: 200 });
    return json({ error: { message: `unexpected ${url}` } }, 400);
  }) as typeof fetch;
  return { calls, client: (creds: PartnerCenterCredentials) => new PartnerCenterClient(creds, fetcher) };
}

const insightsCsv = [
  '﻿Date,OfferName,ReferralDomain,CountryName,PageVisits,GetItNow,ContactMe,FreeTrial',
  '2027-01-12,Deposit Tracker,bing.com,Germany,40,3,1,0',
  '2027-01-12,Deposit Tracker,"google.com, inc",Austria,12,1,0,1',
  '2027-01-13,Deposit Tracker,,Germany,25,2,0,0',
  '2027-01-13,Someone Else’s App,,Germany,999,9,9,9',
  '2026-12-01,Deposit Tracker,,Germany,7,0,0,0',
].join('\r\n');

describe('Partner Center basics', () => {
  it('reads product ids and checks credentials', () => {
    expect(partnerCenterProductId(`https://partner.microsoft.com/dashboard/marketplace-offers/dynamics365-business-central/${OFFER.toUpperCase()}/overview`)).toBe(OFFER);
    expect(partnerCenterProductId(`product/${OFFER}`)).toBe(OFFER);
    expect(partnerCenterProductId('nope')).toBeNull();
    expect(cleanCredentials({ ...credentials, tenantId: ' contoso.onmicrosoft.com ' })).toEqual(credentials);
    expect(cleanCredentials({ ...credentials, clientId: 'abc' })).toBeNull();
    expect(cleanCredentials({ ...credentials, clientSecret: ' ' })).toBeNull();
  });

  it('sums the Marketplace Insights report per day and offer', () => {
    expect(parseCsv('a,"b ""c""",d\r\n1,"2,3",\n')).toEqual([['a', 'b "c"', 'd'], ['1', '2,3', '']]);
    expect(insightsRows(insightsCsv)).toEqual([
      { day: '2026-12-01', offerName: 'Deposit Tracker', pageVisits: 7, getItNow: 0, contactMe: 0, freeTrial: 0 },
      { day: '2027-01-12', offerName: 'Deposit Tracker', pageVisits: 52, getItNow: 4, contactMe: 1, freeTrial: 1 },
      { day: '2027-01-13', offerName: 'Deposit Tracker', pageVisits: 25, getItNow: 2, contactMe: 0, freeTrial: 0 },
      { day: '2027-01-13', offerName: 'Someone Else’s App', pageVisits: 999, getItNow: 9, contactMe: 9, freeTrial: 9 },
    ]);
    expect(insightsRows('nothing,useful\n1,2')).toEqual([]);
  });

  it('gets tokens the way Microsoft documents, and explains failures in both languages', async () => {
    const microsoft = fakeMicrosoft();
    await microsoft.client(credentials).check();
    expect(microsoft.calls[0]).toMatchObject({ url: 'https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/token', body: { grant_type: 'client_credentials', scope: 'https://graph.microsoft.com/.default' } });
    expect(microsoft.calls[1]).toMatchObject({ url: 'https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/token', body: { resource: 'https://api.partnercenter.microsoft.com' } });
    const error = await fakeMicrosoft({ rejectSecret: true }).client(credentials).check().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PartnerCenterError);
    expect(errorText(error, 'en')).toMatch(/did not accept/);
    expect(errorText(error, 'de')).toMatch(/nicht angenommen/);
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('marketplace connection (Postgres)', () => {
  let db: Database;
  let workspaceId: string;
  let userId: string;
  let productId: string;

  const campaignInput = (patch: Partial<CampaignInput> = {}): CampaignInput => ({
    name: 'Launch',
    goal: 'leads',
    status: 'draft',
    audience: '',
    message: '',
    startsOn: '2027-01-11',
    endsOn: '2027-02-07',
    currency: 'EUR',
    budgetCents: 0,
    channels: [],
    notes: '',
    ...patch,
  });
  const results = async (source: string) =>
    (await db.select().from(campaignResults).where(eq(campaignResults.source, source))).map((row) => ({ day: row.day, channel: row.channel, reach: row.reach, clicks: row.clicks, leads: row.leads })).sort((a, b) => a.day.localeCompare(b.day));

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
    await installBuiltinMarket(db, workspaceId, 'business-central');
    productId = (await createProduct(db, workspaceId, 'business-central', { name: 'Deposit Tracker', profile: { does: 'Books deposits.', publisher: 'Example Apps', app_version: '2.4.0.0', editions: ['essentials'], partner_center_id: OFFER, help: 'https://example.com/help', privacy: 'https://example.com/privacy' } })).id;
  });

  it('picks the campaign whose dates cover the day, the latest to start, or an undated running one', async () => {
    const early = await createCampaign(db, workspaceId, userId, campaignInput({ name: 'Early', startsOn: '2027-01-01', endsOn: '2027-03-01', productId }));
    const late = await createCampaign(db, workspaceId, userId, campaignInput({ name: 'Late', startsOn: '2027-01-10', endsOn: null, productId }));
    expect(await campaignForDay(db, workspaceId, productId, '2027-01-05')).toBe(early.id);
    expect(await campaignForDay(db, workspaceId, productId, '2027-01-12')).toBe(late.id);
    expect(await campaignForDay(db, workspaceId, productId, '2026-12-31')).toBeNull();
    const undated = await createCampaign(db, workspaceId, userId, campaignInput({ name: 'Always', startsOn: null, endsOn: null, status: 'running', productId }));
    expect(await campaignForDay(db, workspaceId, productId, '2026-12-31')).toBe(undated.id);
  });

  it('takes leads at the secret address, keeps them with their product, and counts real ones', async () => {
    const campaign = await createCampaign(db, workspaceId, userId, campaignInput({ productId }));
    const { leadToken } = await ensureConnection(db, workspaceId, 'business-central');
    const lead = (action: string, offer = 'Deposit Tracker') => ({ UserDetails: { FirstName: 'Ana', LastName: 'Krause', Email: 'ana@krause.example', Phone: '4930123', Country: 'Germany', Company: 'Getränke Krause KG', Title: 'CFO' }, LeadSource: `AzureMarketplace-${action}| ${offer}`, ActionCode: action, OfferTitle: offer, Description: 'Please call' });
    const day = new Date('2027-01-12T09:00:00Z');
    expect(await receiveLead(db, 'x'.repeat(32), lead('PLT'), day)).toBe(false);
    expect(await receiveLead(db, leadToken, lead('PLT'), day)).toBe(true);
    expect(await receiveLead(db, leadToken, lead('INS'), day)).toBe(true);
    expect(await receiveLead(db, leadToken, lead('DNC'), day)).toBe(true);
    expect(await receiveLead(db, leadToken, lead('PLT', 'Unknown App'), day)).toBe(true);
    // Partner Center's own form of the action, in LeadSource only.
    expect(await receiveLead(db, leadToken, { LeadSource: 'AzureMarketplace-INS| Deposit Tracker', UserDetails: { Email: 'b@example.com' } }, day)).toBe(true);

    const leads = await listLeads(db, workspaceId);
    expect(leads).toHaveLength(5);
    expect(leads.filter((entry) => entry.productId === productId)).toHaveLength(4);
    expect(leads.find((entry) => entry.action === 'PLT' && entry.productId)).toMatchObject({ company: 'Getränke Krause KG', email: 'ana@krause.example', description: 'Please call' });
    expect(await results(MARKETPLACE_SOURCES.leads)).toEqual([{ day: '2027-01-12', channel: 'marketplace', reach: 0, clicks: 0, leads: 3 }]);
    const [row] = await db.select().from(campaignResults);
    expect(row!.campaignId).toBe(campaign.id);

    expect(await deleteLeads(db, workspaceId, { productId })).toBe(4);
    expect(await listLeads(db, workspaceId)).toHaveLength(1);
  });

  it('schedules the daily report, waits for it, then books its numbers per day', async () => {
    await createCampaign(db, workspaceId, userId, campaignInput({ productId }));
    expect(await syncMarketplace(db, workspaceId, 'business-central', fakeMicrosoft().client)).toEqual({ status: 'notConnected' });

    const waiting = fakeMicrosoft({ csv: null });
    await expect(saveCredentials(db, workspaceId, 'business-central', { ...credentials, clientSecret: '' }, waiting.client)).rejects.toThrow(/did not accept/);
    await saveCredentials(db, workspaceId, 'business-central', credentials, waiting.client);
    const [stored] = await db.select().from(marketplaceConnections);
    expect(stored!.credentials).not.toContain('secret');

    expect(await syncMarketplace(db, workspaceId, 'business-central', waiting.client)).toEqual({ status: 'scheduled' });
    const schedule = waiting.calls.find((call) => call.url.endsWith('/ScheduledReport'));
    expect(schedule).toMatchObject({ method: 'POST', url: 'https://api.partnercenter.microsoft.com/insights/v1.1/cmp/ScheduledReport', auth: 'Bearer insights-token', body: { QueryId: '6fd7624b-aa9f-42df-a61d-67d42fd00e92', RecurrenceInterval: 24, Format: 'csv' } });
    expect(await syncMarketplace(db, workspaceId, 'business-central', waiting.client)).toEqual({ status: 'waiting' });

    const ready = fakeMicrosoft({ csv: insightsCsv });
    expect(await syncMarketplace(db, workspaceId, 'business-central', ready.client)).toEqual({ status: 'synced', days: 2 });
    // Reading again replaces a day's numbers instead of adding them up.
    await syncMarketplace(db, workspaceId, 'business-central', ready.client);
    expect(await results(MARKETPLACE_SOURCES.insights)).toEqual([
      { day: '2027-01-12', channel: 'marketplace', reach: 52, clicks: 6, leads: 0 },
      { day: '2027-01-13', channel: 'marketplace', reach: 25, clicks: 2, leads: 0 },
    ]);
  });

  it('records why reading failed, and the worker reads only what is due', async () => {
    await saveCredentials(db, workspaceId, 'business-central', credentials, fakeMicrosoft().client);
    const now = new Date('2027-01-14T10:00:00Z');
    await expect(syncMarketplace(db, workspaceId, 'business-central', fakeMicrosoft({ rejectSecret: true }).client, now)).rejects.toThrow(PartnerCenterError);
    const [failed] = await db.select().from(marketplaceConnections);
    expect(failed).toMatchObject({ lastSyncError: 'credentials' });

    expect(await syncAllMarketplaces(db, fakeMicrosoft().client, new Date(now.getTime() + 60_000))).toBe(0);
    expect(await syncAllMarketplaces(db, fakeMicrosoft().client, new Date(now.getTime() + 7 * 3600_000))).toBe(1);
    const [fixed] = await db.select().from(marketplaceConnections);
    expect(fixed).toMatchObject({ lastSyncError: null, reportId: 'report-1' });

    await removeCredentials(db, workspaceId, 'business-central');
    expect(await syncAllMarketplaces(db, fakeMicrosoft().client, new Date(now.getTime() + 30 * 3600_000))).toBe(0);
  });

  it('sends an approved listing’s texts into the offer’s draft', async () => {
    const campaign = await createCampaign(db, workspaceId, userId, campaignInput({ productId }));
    const piece = await createPiece(db, workspaceId, campaign.id, { kind: 'listing', format: 'listing', title: 'AppSource listing' });
    await saveListingPiece(db, workspaceId, piece.id, { title: 'AppSource listing', content: { texts: { name: 'Deposit Tracker', summary: 'Deposits, booked by themselves.', description: 'Books deposits.' }, keywords: ['deposit', 'beverage'], videos: [], documents: [] } });
    const microsoft = fakeMicrosoft();
    const fast = { attempts: 2, delayMs: 1 };
    await expect(sendListing(db, workspaceId, piece.id, microsoft.client, fast)).rejects.toThrow(/Approve the piece first/);
    // Approval of a draft listing is checked elsewhere; here the status is set directly.
    await db.execute(sql`UPDATE pieces SET status = 'approved' WHERE id = ${piece.id}`);
    expect(await listingDestination(db, workspaceId, piece)).toMatchObject({ marketplaceProductId: OFFER, connected: false });
    await expect(sendListing(db, workspaceId, piece.id, microsoft.client, fast)).rejects.toThrow(/did not accept/);

    await saveCredentials(db, workspaceId, 'business-central', credentials, microsoft.client);
    await sendListing(db, workspaceId, piece.id, microsoft.client, fast);
    const tree = microsoft.calls.find((call) => call.url.includes('/resource-tree/'));
    expect(tree).toMatchObject({ url: `https://graph.microsoft.com/rp/product-ingestion/resource-tree/product/${OFFER}?targetType=draft&$version=2022-07-01`, auth: 'Bearer graph-token' });
    const configure = microsoft.calls.find((call) => call.url.includes('/configure?'));
    expect(configure!.body).toEqual({
      $schema: 'https://schema.mp.microsoft.com/schema/configure/2022-07-01',
      resources: [
        {
          $schema: 'https://schema.mp.microsoft.com/schema/listing/2026-08-01-preview1',
          id: `listing/${OFFER}/main/en-us`,
          kind: 'dynamics365BusinessCentral',
          languageId: 'en-us',
          title: 'Deposit Tracker',
          searchResultSummary: 'Deposits, booked by themselves.',
          description: 'Books deposits.',
          keywords: ['deposit', 'beverage'],
          helpLink: 'https://example.com/help',
          privacyPolicyLink: 'https://example.com/privacy',
        },
      ],
    });

    await expect(sendListing(db, workspaceId, piece.id, fakeMicrosoft({ jobResult: 'failed' }).client, fast)).rejects.toThrow(/refused it: The description is too long/);
    await expect(sendListing(db, workspaceId, piece.id, fakeMicrosoft({ listing: null }).client, fast)).rejects.toThrow(/no listing yet/);
    expect((await setPieceStatus(db, workspaceId, piece.id, 'live', userId)).status).toBe('live');
  });
});
