/**
 * Zernio (https://zernio.com, formerly Late): a social media API from
 * Girona, Spain, with a GDPR data processing agreement. Billed per connected
 * account. API reference: the official @zernio/node SDK (OpenAPI).
 */
import type { Bridge, BridgeAccount, BridgeConfig } from '../bridge';
import { poll, request, requestJson, type RequestOptions } from '../http';
import { getProviderInfo } from '../catalog';
import { ProviderError, type MediaItem, type PostContent, type ProviderId, type PublishContext, type PublishResult } from '../types';

export const ZERNIO_BASE_URL = 'https://zernio.com/api';

/** How often to ask about a post that is still processing (tests shorten it). */
export const zernioTiming = { pollMs: 5_000, timeoutMs: 5 * 60_000 };

/** Postwerk networks → Zernio platform names. Networks Postwerk connects natively without setup are left out. */
const platforms: Partial<Record<ProviderId, string>> = {
  facebook: 'facebook',
  instagram: 'instagram',
  threads: 'threads',
  linkedin: 'linkedin',
  linkedin_page: 'linkedin',
  x: 'twitter',
  tiktok: 'tiktok',
  youtube: 'youtube',
  pinterest: 'pinterest',
  reddit: 'reddit',
  google_business: 'googlebusiness',
};

interface ZernioError {
  error?: string;
  message?: string;
  code?: string;
}

interface ZernioAccount {
  _id: string;
  platform: string;
  username?: string;
  displayName?: string;
  profilePicture?: string | null;
  platformUserId?: string;
  isActive?: boolean;
  needsReconnection?: boolean;
}

interface ZernioPlatformResult {
  platform?: string;
  accountId?: string | { _id?: string };
  status?: string;
  platformPostId?: string;
  platformPostUrl?: string | null;
  errorMessage?: string;
  errorCategory?: string;
}

interface ZernioPost {
  _id?: string;
  status?: string;
  platforms?: ZernioPlatformResult[];
}

function parse(body: string): ZernioError {
  try {
    return JSON.parse(body) as ZernioError;
  } catch {
    return {};
  }
}

/** HTTP errors: an API key problem is the server's, not the account's, so it never asks people to reconnect. */
function mapError(status: number, body: string): ProviderError {
  const { error, message, code } = parse(body);
  const reason = error ?? message ?? `status ${status}`;
  if (status === 401) return new ProviderError('Zernio refused the API key. The server admin needs to check ZERNIO_API_KEY.', { status, retryable: true });
  if (code === 'ACCOUNT_DISCONNECTED' || code === 'ACCOUNT_NOT_ENABLED_FOR_POSTING') {
    return new ProviderError(`Zernio: ${reason}`, { status, needsReauth: true });
  }
  if (status === 404) return new ProviderError(`Zernio no longer has this account: ${reason}`, { status, needsReauth: true });
  // 409: the same idempotency key is still being processed; try again shortly.
  if (status === 409 || status === 429 || status >= 500) return new ProviderError(`Zernio: ${reason}`, { status, retryable: true });
  return new ProviderError(`Zernio: ${reason}`, { status });
}

/** A path with query parameters; undefined ones are left out. */
function query(path: string, params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) if (value !== undefined) search.set(name, String(value));
  return `${path}?${search}`;
}

function api(config: BridgeConfig, path: string, init: RequestOptions = {}) {
  const headers = { accept: 'application/json', authorization: `Bearer ${config.apiKey}`, ...(init.headers as Record<string, string> | undefined) };
  return { url: `${config.baseUrl.replace(/\/$/, '')}/v1${path}`, init: { timeoutMs: 60_000, ...init, headers, mapError } };
}

function getJson<T>(config: BridgeConfig, path: string, init?: RequestOptions): Promise<T> {
  const call = api(config, path, init);
  return requestJson<T>(call.url, call.init);
}

function sendJson<T>(config: BridgeConfig, method: string, path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  return getJson<T>(config, path, { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });
}

function platformOf(network: ProviderId): string {
  const platform = platforms[network];
  if (!platform) throw new ProviderError(`Zernio cannot publish to ${getProviderInfo(network).name}.`);
  return platform;
}

/** A failed network result: whether to retry, ask for a reconnect, or give up depends on Zernio's category. */
function failure(result: ZernioPlatformResult): ProviderError {
  const message = `Zernio: ${result.errorMessage || 'the network rejected the post'}`;
  switch (result.errorCategory) {
    case 'auth_expired':
      return new ProviderError(message, { needsReauth: true });
    case 'platform_error':
    case 'platform_rate_limit':
    case 'quota_exhausted':
    case 'system_error':
    case 'unknown':
      return new ProviderError(message, { retryable: true });
    default:
      // user_content, user_abuse, account_issue, platform_rejected: trying again won't help.
      return new ProviderError(message);
  }
}

const accountIdOf = (result: ZernioPlatformResult) => (typeof result.accountId === 'string' ? result.accountId : result.accountId?._id);

/**
 * Media for Zernio: uploaded files go straight from Postwerk's storage to a
 * presigned upload, so the server needs no public address; links are passed on.
 */
async function mediaItem(config: BridgeConfig, item: MediaItem, context: PublishContext, index: number) {
  const stored = await context.loadMedia?.(item);
  let url = item.url;
  if (stored) {
    const ext = stored.mimeType.split('/')[1]?.replace('quicktime', 'mov') ?? 'bin';
    const presign = await sendJson<{ uploadUrl?: string; publicUrl?: string }>(config, 'POST', '/media/presign', {
      filename: `postwerk-${index + 1}.${ext}`,
      contentType: stored.mimeType,
      size: stored.blob.size,
    });
    if (!presign.uploadUrl || !presign.publicUrl) throw new ProviderError('Zernio did not return an upload address for the media.', { retryable: true });
    await request(presign.uploadUrl, { method: 'PUT', body: stored.blob, headers: { 'content-type': stored.mimeType }, timeoutMs: 300_000 });
    url = presign.publicUrl;
  } else if (!item.url.startsWith('https://')) {
    throw new ProviderError('Zernio needs media at a public https address.');
  }
  return { type: item.kind, url, ...(item.altText && { altText: item.altText }) };
}

/** Per-post fields of Postwerk's catalog in Zernio's names. */
function platformSpecificData(network: ProviderId, options: Record<string, string>): Record<string, unknown> | undefined {
  switch (network) {
    case 'youtube':
      return { title: options.title, visibility: options.privacy };
    case 'tiktok':
      // The person wrote and confirmed the post in Postwerk's composer.
      return { privacyLevel: options.privacy, contentPreviewConfirmed: true, expressConsentGiven: true };
    case 'pinterest':
      return { ...(options.title && { title: options.title }), ...(options.link && { link: options.link }) };
    case 'reddit':
      return { subreddit: options.subreddit, title: options.title };
    default:
      return undefined;
  }
}

function settle(post: ZernioPost, accountId: string): PublishResult | undefined {
  const result = post.platforms?.find((entry) => accountIdOf(entry) === accountId) ?? post.platforms?.[0];
  if (!result) throw new ProviderError('Zernio returned no result for the account.', { retryable: true });
  if (result.status === 'published') return { remoteId: result.platformPostId || post._id!, url: result.platformPostUrl ?? undefined };
  if (result.status === 'failed' || result.status === 'cancelled') throw failure(result);
  return undefined; // pending, processing, uploading
}

async function publish(config: BridgeConfig, network: ProviderId, credentials: { accountId: string }, content: PostContent, context: PublishContext): Promise<PublishResult> {
  const platform = platformOf(network);
  const mediaItems = [];
  for (const [index, item] of content.media.entries()) mediaItems.push(await mediaItem(config, item, context, index));
  const data = platformSpecificData(network, content.options);
  const response = await sendJson<{ post?: ZernioPost }>(
    config,
    'POST',
    '/posts',
    {
      content: content.text,
      ...(mediaItems.length > 0 && { mediaItems }),
      platforms: [{ platform, accountId: credentials.accountId, ...(data && { platformSpecificData: data }) }],
      publishNow: true,
    },
    // The same target always sends the same key, so a retry never posts twice.
    { 'idempotency-key': context.idempotencyKey },
  );
  const post = response.post;
  if (!post?._id) throw new ProviderError('Zernio gave an unexpected answer.', { retryable: true });
  const settled = settle(post, credentials.accountId);
  if (settled) return settled;
  // Videos are processed after upload: wait for the outcome (a retry picks the same post up again).
  return poll(
    async () => settle((await getJson<{ post?: ZernioPost }>(config, `/posts/${encodeURIComponent(post._id!)}`)).post ?? {}, credentials.accountId),
    { what: 'Zernio', intervalMs: zernioTiming.pollMs, timeoutMs: zernioTiming.timeoutMs },
  );
}

export const zernio: Bridge = {
  id: 'zernio',
  name: 'Zernio',
  company: 'ARBICHAT, S.L., Palamós (Girona), Spain',
  privacyUrl: 'https://zernio.com/privacy-policy',
  platforms,

  async createProfile(config, name) {
    const { profile } = await sendJson<{ profile?: { _id?: string } }>(config, 'POST', '/profiles', { name: name.slice(0, 80), description: 'Created by Postwerk' });
    if (!profile?._id) throw new ProviderError('Zernio did not create the profile.', { retryable: true });
    return profile._id;
  },

  async connectUrl(config, { profileId, network, redirectUrl, reconnectAccountId }) {
    const { authUrl } = await getJson<{ authUrl?: string }>(
      config,
      query(`/connect/${platformOf(network)}`, { profileId, redirect_url: redirectUrl, reconnectAccountId }),
    );
    if (!authUrl?.startsWith('https://') && !authUrl?.startsWith('http://')) throw new ProviderError('Zernio did not return a sign-in address.', { retryable: true });
    return authUrl;
  },

  async listAccounts(config, profileId, network) {
    const { accounts = [] } = await getJson<{ accounts?: ZernioAccount[] }>(
      config,
      query('/accounts', { profileId, platform: network ? platformOf(network) : undefined, limit: 100 }),
    );
    return accounts.map(
      (account): BridgeAccount => ({
        id: account._id,
        platform: account.platform,
        username: account.username,
        displayName: account.displayName,
        avatarUrl: account.profilePicture ?? undefined,
        platformUserId: account.platformUserId,
        active: account.isActive !== false && !account.needsReconnection,
      }),
    );
  },

  async disconnect(config, accountId) {
    const call = api(config, `/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' });
    try {
      await request(call.url, call.init);
    } catch (error) {
      if (error instanceof ProviderError && error.status === 404) return;
      throw error;
    }
  },

  publish,
};
