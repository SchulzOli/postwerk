import { afterEach, describe, expect, it, vi } from 'vitest';
import { campaignDays, googleAds, metaAds, type AdLaunchSpec } from '../src/ads';
import { GRAPH_VERSION } from '../src/meta';
import { ProviderError } from '../src/types';
import { mockFetch } from './helpers';

afterEach(() => vi.unstubAllGlobals());

const GADS = 'https://googleads.googleapis.com/v25';
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

const spec = (overrides: Partial<AdLaunchSpec> = {}): AdLaunchSpec => ({
  name: 'Rückenwochen – Suchanzeige',
  format: 'search',
  goal: 'leads',
  budgetMinor: 60_000,
  startsOn: '2099-11-01',
  endsOn: '2099-11-30',
  countries: ['DE', 'AT'],
  language: 'de',
  finalUrl: 'https://praxis.example/termin',
  headlines: ['Rückenschmerzen?', 'Physio in Berlin', 'Termin online buchen'],
  descriptions: ['Kurze Übungen fürs Büro.', 'Kostenlose Haltungsanalyse.'],
  path1: 'ruecken',
  path2: 'termin',
  keywords: ['physiotherapie berlin', 'rückenschmerzen büro'],
  ...overrides,
});

describe('ad helpers', () => {
  it('counts campaign days inclusively', () => {
    expect(campaignDays('2026-11-01', '2026-11-30')).toBe(30);
    expect(campaignDays('2026-11-01', '2026-11-01')).toBe(1);
  });
});

describe('Google Ads', () => {
  const platform = googleAds({ developerToken: 'dev-token', loginCustomerId: '1112223333' });
  const access = { accessToken: 'tok', accountId: '1234567890' };

  it('lists the customers it can run campaigns in', async () => {
    const calls = mockFetch([
      [`GET ${GADS}/customers:listAccessibleCustomers`, () => ({ resourceNames: ['customers/1234567890', 'customers/999'] })],
      [
        `POST ${GADS}/customers/1234567890/googleAds:search`,
        () => ({ results: [{ customer: { id: '1234567890', descriptiveName: 'Praxis', currencyCode: 'EUR', timeZone: 'Europe/Berlin', manager: false, testAccount: true } }] }),
      ],
      [`POST ${GADS}/customers/999/googleAds:search`, () => ({ results: [{ customer: { id: '999', currencyCode: 'EUR', manager: true } }] })],
    ]);
    expect(await platform.listAccounts('tok')).toEqual([{ id: '1234567890', name: 'Praxis', currency: 'EUR', timeZone: 'Europe/Berlin', test: true }]);
    expect(calls[0]!.headers).toMatchObject({ authorization: 'Bearer tok', 'developer-token': 'dev-token', 'login-customer-id': '1112223333' });
  });

  it('builds a paused search campaign with budget, targeting, keywords and the ad in one request', async () => {
    const calls = mockFetch([
      [
        `POST ${GADS}/customers/1234567890/googleAds:mutate`,
        () => ({ mutateOperationResponses: [{ campaignBudgetResult: { resourceName: 'customers/1234567890/campaignBudgets/5' } }, { campaignResult: { resourceName: 'customers/1234567890/campaigns/777' } }] }),
      ],
    ]);
    const launched = await platform.launch(access, spec());
    expect(launched.campaignId).toBe('777');
    const operations = (calls[0]!.body as { mutateOperations: Record<string, { create: Record<string, unknown> }>[] }).mutateOperations;
    const kinds = operations.map((operation) => Object.keys(operation)[0]);
    expect(kinds).toEqual([
      'campaignBudgetOperation',
      'campaignOperation',
      'campaignCriterionOperation',
      'campaignCriterionOperation',
      'campaignCriterionOperation',
      'adGroupOperation',
      'adGroupCriterionOperation',
      'adGroupCriterionOperation',
      'adGroupAdOperation',
    ]);
    // 600 € over 30 days: 20 € a day.
    expect(operations[0]!.campaignBudgetOperation!.create).toMatchObject({ amountMicros: '20000000', explicitlyShared: false });
    expect(operations[1]!.campaignOperation!.create).toMatchObject({
      advertisingChannelType: 'SEARCH',
      status: 'PAUSED',
      targetSpend: {},
      startDateTime: '2099-11-01 00:00:00',
      endDateTime: '2099-11-30 23:59:59',
      containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
    });
    expect(operations.slice(2, 5).map((operation) => operation.campaignCriterionOperation!.create)).toEqual([
      { campaign: 'customers/1234567890/campaigns/-2', location: { geoTargetConstant: 'geoTargetConstants/2276' } },
      { campaign: 'customers/1234567890/campaigns/-2', location: { geoTargetConstant: 'geoTargetConstants/2040' } },
      { campaign: 'customers/1234567890/campaigns/-2', language: { languageConstant: 'languageConstants/1001' } },
    ]);
    expect(operations[6]!.adGroupCriterionOperation!.create).toMatchObject({ keyword: { text: 'physiotherapie berlin', matchType: 'PHRASE' } });
    expect(operations[8]!.adGroupAdOperation!.create).toMatchObject({
      ad: { finalUrls: ['https://praxis.example/termin'], responsiveSearchAd: { headlines: [{ text: 'Rückenschmerzen?' }, { text: 'Physio in Berlin' }, { text: 'Termin online buchen' }], path1: 'ruecken', path2: 'termin' } },
    });
  });

  it('builds a Demand Gen video campaign shown on YouTube only', async () => {
    const calls = mockFetch([[`POST ${GADS}/customers/1234567890/googleAds:mutate`, () => ({ mutateOperationResponses: [{ campaignResult: { resourceName: 'customers/1234567890/campaigns/888' } }] })]]);
    await platform.launch(access, spec({ format: 'video', keywords: undefined, longHeadlines: ['Rudi zeigt dir drei Übungen fürs Büro'], youtubeVideoId: 'dQw4w9WgXcQ', businessName: 'Praxis', image: { bytes: new Uint8Array([137, 80, 78, 71]), name: 'logo.png' } }));
    const operations = (calls[0]!.body as { mutateOperations: Record<string, { create: Record<string, unknown> }>[] }).mutateOperations;
    expect(operations[1]!.campaignOperation!.create).toMatchObject({ advertisingChannelType: 'DEMAND_GEN' });
    const adGroup = operations.find((operation) => operation.adGroupOperation)!.adGroupOperation!.create;
    expect(adGroup.demandGenAdGroupSettings).toEqual({ channelControls: { selectedChannels: { youtubeInStream: true, youtubeInFeed: true, youtubeShorts: true } } });
    // Targeting sits on the ad group (upgraded targeting).
    expect(operations.filter((operation) => operation.campaignCriterionOperation)).toHaveLength(0);
    expect(operations.filter((operation) => operation.adGroupCriterionOperation)).toHaveLength(3);
    const assets = operations.filter((operation) => operation.assetOperation).map((operation) => operation.assetOperation!.create);
    expect(assets[0]).toMatchObject({ type: 'YOUTUBE_VIDEO', youtubeVideoAsset: { youtubeVideoId: 'dQw4w9WgXcQ' } });
    expect(assets[1]).toMatchObject({ type: 'IMAGE', imageAsset: { data: 'iVBORw==' } });
    expect(operations.at(-1)!.adGroupAdOperation!.create).toMatchObject({
      ad: { demandGenVideoResponsiveAd: { videos: [{ asset: 'customers/1234567890/assets/-4' }], logoImages: [{ asset: 'customers/1234567890/assets/-5' }], businessName: { text: 'Praxis' } } },
    });
  });

  it('starts, pauses and reads daily numbers', async () => {
    const calls = mockFetch([
      [`POST ${GADS}/customers/1234567890/googleAds:mutate`, () => ({})],
      [
        `POST ${GADS}/customers/1234567890/googleAds:search`,
        () => ({ results: [{ segments: { date: '2099-11-01' }, metrics: { impressions: '1200', clicks: '40', costMicros: '18500000', conversions: 2, conversionsValue: 0 } }] }),
      ],
    ]);
    await platform.setRunning(access, '777', true);
    expect(calls[0]!.body).toEqual({ mutateOperations: [{ campaignOperation: { update: { resourceName: 'customers/1234567890/campaigns/777', status: 'ENABLED' }, updateMask: 'status' } }] });
    expect(await platform.stats(access, '777', '2099-11-01', '2099-11-02')).toEqual([{ day: '2099-11-01', impressions: 1200, clicks: 40, conversions: 2, costMinor: 1850, conversionValueMinor: 0 }]);
    expect((calls[1]!.body as { query: string }).query).toContain("campaign.id = 777 AND segments.date BETWEEN '2099-11-01' AND '2099-11-02'");
  });

  it('explains Google Ads errors', async () => {
    mockFetch([
      [
        `POST ${GADS}/customers/1234567890/googleAds:mutate`,
        () =>
          Response.json(
            { error: { code: 403, status: 'PERMISSION_DENIED', details: [{ errors: [{ errorCode: { authorizationError: 'DEVELOPER_TOKEN_NOT_APPROVED' }, message: 'The developer token is only approved for use with test accounts.' }] }] } },
            { status: 403 },
          ),
      ],
    ]);
    const error = await platform.setRunning(access, '1', true).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).message).toMatch(/GOOGLE_ADS_DEVELOPER_TOKEN/);
    expect((error as ProviderError).needsReauth).toBe(false);
  });
});

describe('Meta Ads', () => {
  const platform = metaAds();
  const access = { accessToken: 'tok', accountId: '55' };

  it('lists active ad accounts with the Pages ads can run as', async () => {
    mockFetch([
      [
        `GET ${GRAPH}/me/adaccounts`,
        () => ({ data: [{ account_id: '55', name: 'Praxis', currency: 'EUR', timezone_name: 'Europe/Berlin', account_status: 1 }, { account_id: '66', name: 'Closed', currency: 'EUR', account_status: 2 }] }),
      ],
      [`GET ${GRAPH}/me/accounts`, () => ({ data: [{ id: 'p1', name: 'Praxis Ruhige Nähe' }] })],
    ]);
    expect(await platform.listAccounts('tok')).toEqual([{ id: '55', name: 'Praxis', currency: 'EUR', timeZone: 'Europe/Berlin', pages: [{ id: 'p1', name: 'Praxis Ruhige Nähe' }] }]);
  });

  it('builds a paused campaign with a capped ad set, creative and ad', async () => {
    const calls = mockFetch([
      [`POST ${GRAPH}/act_55/adimages`, () => ({ images: { 'bild.png': { hash: 'h1' } } })],
      [`POST ${GRAPH}/act_55/campaigns`, () => ({ id: 'c1' })],
      [`POST ${GRAPH}/act_55/adsets`, () => ({ id: 's1' })],
      [`POST ${GRAPH}/act_55/adcreatives`, () => ({ id: 'cr1' })],
      [`POST ${GRAPH}/act_55/ads`, () => ({ id: 'a1' })],
    ]);
    const launched = await platform.launch(access, spec({ format: 'social', headlines: ['Rücken? Rudi hilft!'], descriptions: ['Kurze Übungen fürs Büro.'], callToAction: 'BOOK_NOW', pageId: 'p1', image: { bytes: new Uint8Array([1, 2]), name: 'bild.png' } }));
    expect(launched.campaignId).toBe('c1');
    const body = (index: number) => calls[index]!.body as Record<string, string>;
    expect(body(1)).toMatchObject({ objective: 'OUTCOME_TRAFFIC', status: 'PAUSED', special_ad_categories: '[]', is_adset_budget_sharing_enabled: 'false' });
    expect(body(2)).toMatchObject({ campaign_id: 'c1', lifetime_budget: '60000', start_time: '2099-11-01T00:00:00+0000', end_time: '2099-11-30T23:59:59+0000', optimization_goal: 'LINK_CLICKS', destination_type: 'WEBSITE' });
    expect(JSON.parse(body(2).targeting!)).toMatchObject({ geo_locations: { countries: ['DE', 'AT'] } });
    expect(JSON.parse(body(3).object_story_spec!)).toEqual({
      page_id: 'p1',
      link_data: { image_hash: 'h1', link: 'https://praxis.example/termin', message: 'Kurze Übungen fürs Büro.', name: 'Rücken? Rudi hilft!', call_to_action: { type: 'BOOK_NOW', value: { link: 'https://praxis.example/termin' } } },
    });
    expect(body(4)).toMatchObject({ adset_id: 's1', creative: JSON.stringify({ creative_id: 'cr1' }) });
  });

  it('removes a half-built campaign when a later step fails', async () => {
    const calls = mockFetch([
      [`POST ${GRAPH}/act_55/adimages`, () => ({ images: { x: { hash: 'h1' } } })],
      [`POST ${GRAPH}/act_55/campaigns`, () => ({ id: 'c1' })],
      [`POST ${GRAPH}/act_55/adsets`, () => Response.json({ error: { code: 100, message: 'Invalid parameter' } }, { status: 400 })],
      [`DELETE ${GRAPH}/c1`, () => ({ success: true })],
    ]);
    await expect(platform.launch(access, spec({ format: 'social', pageId: 'p1', image: { bytes: new Uint8Array([1]), name: 'x' } }))).rejects.toThrow(/Invalid parameter/);
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE' });
  });

  it('reads daily insights page by page', async () => {
    mockFetch([
      [
        `GET ${GRAPH}/c1/insights`,
        (call) =>
          call.url.includes('after=2')
            ? { data: [{ date_start: '2099-11-02', impressions: '50', clicks: '1', spend: '1.10' }] }
            : { data: [{ date_start: '2099-11-01', impressions: '900', clicks: '30', spend: '12.34', actions: [{ action_type: 'lead', value: '2' }, { action_type: 'link_click', value: '30' }] }], paging: { next: `${GRAPH}/c1/insights?after=2` } },
      ],
    ]);
    expect(await platform.stats(access, 'c1', '2099-11-01', '2099-11-02')).toEqual([
      { day: '2099-11-01', impressions: 900, clicks: 30, conversions: 2, costMinor: 1234, conversionValueMinor: 0 },
      { day: '2099-11-02', impressions: 50, clicks: 1, conversions: 0, costMinor: 110, conversionValueMinor: 0 },
    ]);
  });
});
