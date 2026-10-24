/**
 * Google Ads API (REST, v25; see the official google-ads-node protos). Search
 * ads are a Search campaign with one responsive search ad and its keywords;
 * video ads are a Demand Gen campaign showing a YouTube video on YouTube only
 * (in-stream, in-feed and Shorts). Every campaign is created paused, with a
 * daily budget that spreads the total over its days and an end date.
 *
 * Needs the server admin's Google app (GOOGLE_CLIENT_ID/SECRET, scope adwords)
 * and a Google Ads developer token (GOOGLE_ADS_DEVELOPER_TOKEN).
 */
import { requestJson } from '../http';
import { ProviderError } from '../types';
import { campaignDays, type AdAccess, type AdAccountInfo, type AdDayStats, type AdLaunchSpec, type AdPlatform, type LaunchedCampaign } from './types';

export const GOOGLE_ADS_VERSION = 'v25';
export const GOOGLE_ADS_SCOPE = 'https://www.googleapis.com/auth/adwords';

export interface GoogleAdsConfig {
  developerToken: string;
  /** A manager account the customers are reached through, without dashes. */
  loginCustomerId?: string;
  /** API address (a fake server in tests). */
  baseUrl?: string;
}

/** Geo target constants of the countries offered (https://developers.google.com/google-ads/api/data/geotargets). */
export const GOOGLE_GEO_TARGETS: Record<string, number> = { DE: 2276, AT: 2040, CH: 2756, LI: 2438, LU: 2442, NL: 2528, BE: 2056, FR: 2250, IT: 2380, ES: 2724, GB: 2826, US: 2840 };
/** Language constants (https://developers.google.com/google-ads/api/data/codes-formats#languages). */
export const GOOGLE_LANGUAGES: Record<string, number> = { de: 1001, en: 1000, fr: 1002, it: 1004, es: 1003, nl: 1010 };

interface GoogleAdsErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: { errors?: { errorCode?: Record<string, string>; message?: string }[] }[];
  };
}

/** Google Ads errors carry their reasons in GoogleAdsFailure details. */
export function googleAdsError(status: number, body: string): ProviderError {
  let parsed: GoogleAdsErrorBody = {};
  try {
    parsed = JSON.parse(body) as GoogleAdsErrorBody;
  } catch {
    // not JSON
  }
  const errors = parsed.error?.details?.flatMap((detail) => detail.errors ?? []) ?? [];
  const codes = errors.flatMap((error) => Object.values(error.errorCode ?? {}));
  const detail = errors.map((error) => error.message).filter(Boolean).join(' ') || parsed.error?.message || `HTTP ${status}`;
  if (codes.some((code) => code.startsWith('DEVELOPER_TOKEN'))) {
    return new ProviderError(`Google Ads does not accept this server's developer token yet (${detail}). The server admin needs to check GOOGLE_ADS_DEVELOPER_TOKEN and its access level.`, { status });
  }
  if (status === 401 || codes.includes('OAUTH_TOKEN_REVOKED') || codes.includes('OAUTH_TOKEN_EXPIRED')) {
    return new ProviderError(`Google Ads access has expired. Please connect the ad account again. (${detail})`, { status, needsReauth: true });
  }
  if (codes.includes('RESOURCE_EXHAUSTED') || parsed.error?.status === 'RESOURCE_EXHAUSTED' || status === 429 || status >= 500) {
    return new ProviderError(`Google Ads is busy: ${detail}`, { status, retryable: true });
  }
  return new ProviderError(`Google Ads: ${detail}`, { status });
}

type Operation = Record<string, unknown>;

/** "YYYY-MM-DD" of today in UTC. */
const today = () => new Date().toISOString().slice(0, 10);

export function googleAds(config: GoogleAdsConfig): AdPlatform {
  const base = `${config.baseUrl ?? 'https://googleads.googleapis.com'}/${GOOGLE_ADS_VERSION}`;
  const headers = (accessToken: string) => ({
    authorization: `Bearer ${accessToken}`,
    'developer-token': config.developerToken,
    ...(config.loginCustomerId && { 'login-customer-id': config.loginCustomerId }),
    'content-type': 'application/json',
  });
  const call = <T>(accessToken: string, path: string, body?: unknown) =>
    requestJson<T>(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: headers(accessToken),
      body: body === undefined ? undefined : JSON.stringify(body),
      timeoutMs: 60_000,
      mapError: googleAdsError,
    });
  const search = async <T>(access: AdAccess, query: string) => {
    const rows: T[] = [];
    let pageToken: string | undefined;
    do {
      const page = await call<{ results?: T[]; nextPageToken?: string }>(access.accessToken, `/customers/${access.accountId}/googleAds:search`, { query, ...(pageToken && { pageToken }) });
      rows.push(...(page.results ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return rows;
  };
  const mutate = (access: AdAccess, operations: Operation[]) =>
    call<{ mutateOperationResponses?: Record<string, { resourceName?: string }>[] }>(access.accessToken, `/customers/${access.accountId}/googleAds:mutate`, { mutateOperations: operations });

  return {
    id: 'google_ads',
    name: 'Google Ads',

    async listAccounts(accessToken) {
      const { resourceNames = [] } = await call<{ resourceNames?: string[] }>(accessToken, '/customers:listAccessibleCustomers');
      const accounts: AdAccountInfo[] = [];
      for (const name of resourceNames.slice(0, 50)) {
        const id = name.split('/')[1]!;
        try {
          const [row] = await search<{ customer: { id: string; descriptiveName?: string; currencyCode: string; timeZone?: string; manager?: boolean; testAccount?: boolean } }>(
            { accessToken, accountId: id },
            'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager, customer.test_account FROM customer LIMIT 1',
          );
          // Manager accounts run no campaigns themselves.
          if (!row || row.customer.manager) continue;
          accounts.push({ id, name: row.customer.descriptiveName || id, currency: row.customer.currencyCode, timeZone: row.customer.timeZone, test: Boolean(row.customer.testAccount) });
        } catch (error) {
          // Cancelled or unreachable customers are skipped; a token problem is not.
          if (error instanceof ProviderError && (error.needsReauth || error.message.includes('developer token'))) throw error;
        }
      }
      return accounts;
    },

    async launch(access, spec): Promise<LaunchedCampaign> {
      const customer = `customers/${access.accountId}`;
      const budget = `${customer}/campaignBudgets/-1`;
      const campaign = `${customer}/campaigns/-2`;
      const adGroup = `${customer}/adGroups/-3`;
      const startsOn = spec.startsOn < today() ? today() : spec.startsOn;
      const days = campaignDays(startsOn, spec.endsOn);
      // Daily budget in micros, a whole number of cents (Google may spend more on a day, but not more over the period).
      const dailyMicros = Math.max(1, Math.floor(spec.budgetMinor / days)) * 10_000;
      const video = spec.format === 'video';
      const locations = spec.countries.map((country) => GOOGLE_GEO_TARGETS[country]).filter((id): id is number => id !== undefined);
      const language = GOOGLE_LANGUAGES[spec.language];
      const targeting = [
        ...locations.map((id) => ({ location: { geoTargetConstant: `geoTargetConstants/${id}` } })),
        ...(language ? [{ language: { languageConstant: `languageConstants/${language}` } }] : []),
      ];

      const operations: Operation[] = [
        { campaignBudgetOperation: { create: { resourceName: budget, name: `${spec.name} (${new Date().toISOString()})`, amountMicros: String(dailyMicros), deliveryMethod: 'STANDARD', explicitlyShared: false } } },
        {
          campaignOperation: {
            create: {
              resourceName: campaign,
              name: spec.name,
              advertisingChannelType: video ? 'DEMAND_GEN' : 'SEARCH',
              status: 'PAUSED',
              campaignBudget: budget,
              // Maximize clicks: no conversion tracking needed.
              targetSpend: {},
              startDateTime: `${startsOn} 00:00:00`,
              endDateTime: `${spec.endsOn} 23:59:59`,
              containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
              ...(!video && { networkSettings: { targetGoogleSearch: true, targetSearchNetwork: true, targetContentNetwork: false, targetPartnerSearchNetwork: false } }),
            },
          },
        },
        // Search campaigns target at campaign level; Demand Gen (upgraded targeting) per ad group.
        ...(video ? [] : targeting.map((criterion) => ({ campaignCriterionOperation: { create: { campaign, ...criterion } } }))),
        {
          adGroupOperation: {
            create: {
              resourceName: adGroup,
              name: spec.name,
              campaign,
              status: 'ENABLED',
              ...(video
                ? { demandGenAdGroupSettings: { channelControls: { selectedChannels: { youtubeInStream: true, youtubeInFeed: true, youtubeShorts: true } } } }
                : { type: 'SEARCH_STANDARD' }),
            },
          },
        },
        ...(video ? targeting.map((criterion) => ({ adGroupCriterionOperation: { create: { adGroup, ...criterion } } })) : []),
      ];

      if (video) {
        if (!spec.youtubeVideoId) throw new ProviderError('Google Ads: the video ad needs a YouTube video.');
        if (!spec.image) throw new ProviderError('Google Ads: the video ad needs a square logo (at least 128 × 128 pixels).');
        const videoAsset = `${customer}/assets/-4`;
        const logoAsset = `${customer}/assets/-5`;
        operations.push(
          { assetOperation: { create: { resourceName: videoAsset, name: `${spec.name} video`, type: 'YOUTUBE_VIDEO', youtubeVideoAsset: { youtubeVideoId: spec.youtubeVideoId } } } },
          { assetOperation: { create: { resourceName: logoAsset, name: `${spec.name} logo ${Date.now()}`, type: 'IMAGE', imageAsset: { data: Buffer.from(spec.image.bytes).toString('base64') } } } },
          {
            adGroupAdOperation: {
              create: {
                adGroup,
                status: 'ENABLED',
                ad: {
                  name: spec.name,
                  finalUrls: [spec.finalUrl],
                  demandGenVideoResponsiveAd: {
                    headlines: spec.headlines.map((text) => ({ text })),
                    longHeadlines: (spec.longHeadlines ?? []).map((text) => ({ text })),
                    descriptions: spec.descriptions.map((text) => ({ text })),
                    videos: [{ asset: videoAsset }],
                    logoImages: [{ asset: logoAsset }],
                    businessName: { text: spec.businessName ?? spec.name },
                  },
                },
              },
            },
          },
        );
      } else {
        operations.push(
          ...(spec.keywords ?? []).map((text) => ({ adGroupCriterionOperation: { create: { adGroup, status: 'ENABLED', keyword: { text, matchType: 'PHRASE' } } } })),
          {
            adGroupAdOperation: {
              create: {
                adGroup,
                status: 'ENABLED',
                ad: {
                  finalUrls: [spec.finalUrl],
                  responsiveSearchAd: {
                    headlines: spec.headlines.map((text) => ({ text })),
                    descriptions: spec.descriptions.map((text) => ({ text })),
                    ...(spec.path1 && { path1: spec.path1 }),
                    ...(spec.path1 && spec.path2 && { path2: spec.path2 }),
                  },
                },
              },
            },
          },
        );
      }

      const { mutateOperationResponses = [] } = await mutate(access, operations);
      const created = mutateOperationResponses.map((response) => response.campaignResult?.resourceName).find(Boolean);
      if (!created) throw new ProviderError('Google Ads did not return the new campaign.', { retryable: true });
      const campaignId = created.split('/').pop()!;
      return { campaignId, url: `https://ads.google.com/aw/campaigns?campaignId=${campaignId}&__c=${access.accountId}` };
    },

    async setRunning(access, campaignId, running) {
      await mutate(access, [{ campaignOperation: { update: { resourceName: `customers/${access.accountId}/campaigns/${campaignId}`, status: running ? 'ENABLED' : 'PAUSED' }, updateMask: 'status' } }]);
    },

    async stats(access, campaignId, from, to): Promise<AdDayStats[]> {
      if (!/^\d+$/.test(campaignId) || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new ProviderError('Google Ads: invalid campaign or dates.');
      const rows = await search<{ segments: { date: string }; metrics: { impressions?: string; clicks?: string; costMicros?: string; conversions?: number; conversionsValue?: number } }>(
        access,
        `SELECT segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM campaign WHERE campaign.id = ${campaignId} AND segments.date BETWEEN '${from}' AND '${to}'`,
      );
      return rows.map(({ segments, metrics }) => ({
        day: segments.date,
        impressions: Number(metrics.impressions ?? 0),
        clicks: Number(metrics.clicks ?? 0),
        conversions: Math.round(Number(metrics.conversions ?? 0)),
        costMinor: Math.round(Number(metrics.costMicros ?? 0) / 10_000),
        conversionValueMinor: Math.round(Number(metrics.conversionsValue ?? 0) * 100),
      }));
    },
  };
}
