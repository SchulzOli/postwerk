/**
 * Meta Marketing API (Graph API, same version as the Facebook network). A
 * social ad becomes a campaign (paused) with one ad set and one image ad for
 * Facebook and Instagram: the ad set has a lifetime budget, which is a hard
 * cap, and runs from the start to the end date.
 *
 * Needs the server admin's Facebook app (FACEBOOK_CLIENT_ID/SECRET) with the
 * Marketing API, and ENABLE_META_ADS=true. For your own ad accounts, the
 * app's standard access is enough; others need Meta's app review.
 */
import { graphError, GRAPH_VERSION } from '../meta';
import { form, requestJson, withQuery } from '../http';
import { ProviderError } from '../types';
import { type AdAccess, type AdAccountInfo, type AdDayStats, type AdLaunchSpec, type AdPlatform, type LaunchedCampaign } from './types';

export const META_ADS_SCOPES = ['ads_management', 'ads_read', 'business_management', 'pages_show_list', 'pages_read_engagement'];
/** Call-to-action buttons offered for social ads. */
export const META_CALLS_TO_ACTION = ['LEARN_MORE', 'BOOK_NOW', 'SIGN_UP', 'CONTACT_US', 'SHOP_NOW'] as const;

type Params = Record<string, string | number | boolean | undefined>;

export interface MetaAdsConfig {
  /** Graph API address (a fake server in tests). */
  baseUrl?: string;
}

/** "2026-11-02" → a time Meta accepts, at the start (or end) of that day in UTC. */
const isoDay = (day: string, end = false) => `${day}T${end ? '23:59:59' : '00:00:00'}+0000`;

export function metaAds(config: MetaAdsConfig = {}): AdPlatform {
  const base = `${config.baseUrl ?? 'https://graph.facebook.com'}/${GRAPH_VERSION}`;
  const mapError = (status: number, body: string) => graphError('Meta Ads', status, body);
  const get = <T>(token: string, path: string, params: Params = {}) => requestJson<T>(withQuery(`${base}${path}`, { ...params, access_token: token }), { timeoutMs: 60_000, mapError });
  const post = <T>(token: string, path: string, params: Params) => requestJson<T>(`${base}${path}`, { ...form({ ...params, access_token: token }), timeoutMs: 60_000, mapError });
  const del = (token: string, path: string) => requestJson(withQuery(`${base}${path}`, { access_token: token }), { method: 'DELETE', timeoutMs: 30_000, mapError }).catch(() => undefined);

  return {
    id: 'meta_ads',
    name: 'Meta Ads',

    async listAccounts(token) {
      const [accounts, pages] = await Promise.all([
        get<{ data?: { account_id: string; name?: string; currency: string; timezone_name?: string; account_status?: number }[] }>(token, '/me/adaccounts', { fields: 'account_id,name,currency,timezone_name,account_status', limit: 100 }),
        get<{ data?: { id: string; name: string }[] }>(token, '/me/accounts', { fields: 'id,name', limit: 100 }),
      ]);
      const pageList = (pages.data ?? []).map((page) => ({ id: page.id, name: page.name }));
      // Status 1 is active; disabled or closed accounts cannot run ads.
      return (accounts.data ?? [])
        .filter((account) => account.account_status === undefined || account.account_status === 1)
        .map((account): AdAccountInfo => ({ id: account.account_id, name: account.name || account.account_id, currency: account.currency, timeZone: account.timezone_name, pages: pageList }));
    },

    async launch(access, spec): Promise<LaunchedCampaign> {
      const { accessToken: token, accountId } = access;
      const act = `/act_${accountId}`;
      if (!spec.pageId) throw new ProviderError('Meta Ads: choose the Facebook Page the ad runs as.');
      if (!spec.image) throw new ProviderError('Meta Ads: the ad needs a picture.');
      const awareness = spec.goal === 'awareness';

      const uploaded = await post<{ images?: Record<string, { hash: string }> }>(token, `${act}/adimages`, { bytes: Buffer.from(spec.image.bytes).toString('base64'), name: spec.image.name });
      const hash = Object.values(uploaded.images ?? {})[0]?.hash;
      if (!hash) throw new ProviderError('Meta Ads did not take the picture.', { retryable: true });

      const campaign = await post<{ id: string }>(token, `${act}/campaigns`, {
        name: spec.name,
        objective: awareness ? 'OUTCOME_AWARENESS' : 'OUTCOME_TRAFFIC',
        status: 'PAUSED',
        special_ad_categories: '[]',
        // The budget sits on the ad set.
        is_adset_budget_sharing_enabled: false,
      });
      try {
        const adSet = await post<{ id: string }>(token, `${act}/adsets`, {
          name: spec.name,
          campaign_id: campaign.id,
          // A lifetime budget is never exceeded.
          lifetime_budget: spec.budgetMinor,
          start_time: isoDay(spec.startsOn),
          end_time: isoDay(spec.endsOn, true),
          billing_event: 'IMPRESSIONS',
          optimization_goal: awareness ? 'REACH' : 'LINK_CLICKS',
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          ...(!awareness && { destination_type: 'WEBSITE' }),
          targeting: JSON.stringify({ geo_locations: { countries: spec.countries }, age_min: 18, targeting_automation: { advantage_audience: 0 } }),
          status: 'ACTIVE',
        });
        const creative = await post<{ id: string }>(token, `${act}/adcreatives`, {
          name: spec.name,
          object_story_spec: JSON.stringify({
            page_id: spec.pageId,
            link_data: {
              image_hash: hash,
              link: spec.finalUrl,
              message: spec.descriptions[0] ?? '',
              name: spec.headlines[0] ?? '',
              call_to_action: { type: spec.callToAction ?? 'LEARN_MORE', value: { link: spec.finalUrl } },
            },
          }),
        });
        await post(token, `${act}/ads`, { name: spec.name, adset_id: adSet.id, creative: JSON.stringify({ creative_id: creative.id }), status: 'ACTIVE' });
      } catch (error) {
        // Leave nothing half-built behind.
        await del(token, `/${campaign.id}`);
        throw error;
      }
      return { campaignId: campaign.id, url: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${accountId}&selected_campaign_ids=${campaign.id}` };
    },

    async setRunning(access, campaignId, running) {
      await post(access.accessToken, `/${campaignId}`, { status: running ? 'ACTIVE' : 'PAUSED' });
    },

    async stats(access, campaignId, from, to): Promise<AdDayStats[]> {
      type Row = { date_start: string; impressions?: string; clicks?: string; spend?: string; actions?: { action_type: string; value: string }[]; action_values?: { action_type: string; value: string }[] };
      const rows: Row[] = [];
      let next: string | undefined = withQuery(`${base}/${campaignId}/insights`, {
        fields: 'impressions,clicks,spend,actions,action_values',
        time_increment: 1,
        time_range: JSON.stringify({ since: from, until: to }),
        limit: 100,
        access_token: access.accessToken,
      });
      while (next) {
        const page: { data?: Row[]; paging?: { next?: string } } = await requestJson(next, { timeoutMs: 60_000, mapError });
        rows.push(...(page.data ?? []));
        next = page.paging?.next;
      }
      const sum = (entries: { action_type: string; value: string }[] | undefined, types: string[]) => (entries ?? []).filter((entry) => types.includes(entry.action_type)).reduce((total, entry) => total + Number(entry.value), 0);
      return rows.map((row) => ({
        day: row.date_start,
        impressions: Number(row.impressions ?? 0),
        clicks: Number(row.clicks ?? 0),
        conversions: Math.round(sum(row.actions, ['lead', 'purchase'])),
        costMinor: Math.round(Number(row.spend ?? 0) * 100),
        conversionValueMinor: Math.round(sum(row.action_values, ['purchase']) * 100),
      }));
    },
  };
}

/** Swaps a short-lived user token for a long-lived one (about 60 days). */
export async function longLivedMetaToken(client: { clientId: string; clientSecret: string }, token: string, baseUrl = 'https://graph.facebook.com'): Promise<{ accessToken: string; expiresAt?: number }> {
  const response = await requestJson<{ access_token: string; expires_in?: number }>(
    withQuery(`${baseUrl}/${GRAPH_VERSION}/oauth/access_token`, { grant_type: 'fb_exchange_token', client_id: client.clientId, client_secret: client.clientSecret, fb_exchange_token: token }),
    { mapError: (status, body) => graphError('Meta Ads', status, body) },
  );
  return { accessToken: response.access_token, expiresAt: response.expires_in ? Date.now() + response.expires_in * 1000 : undefined };
}

export function metaAdsAuthorizeUrl(client: { clientId: string }, redirectUri: string, state: string): string {
  return withQuery(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`, { client_id: client.clientId, redirect_uri: redirectUri, state, response_type: 'code', scope: META_ADS_SCOPES.join(',') });
}

export async function exchangeMetaAdsCode(client: { clientId: string; clientSecret: string }, code: string, redirectUri: string, baseUrl = 'https://graph.facebook.com'): Promise<{ accessToken: string; expiresAt?: number }> {
  const short = await requestJson<{ access_token: string }>(
    withQuery(`${baseUrl}/${GRAPH_VERSION}/oauth/access_token`, { client_id: client.clientId, client_secret: client.clientSecret, redirect_uri: redirectUri, code }),
    { mapError: (status, body) => graphError('Meta Ads', status, body) },
  );
  return longLivedMetaToken(client, short.access_token, baseUrl);
}


