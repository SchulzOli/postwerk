import { catalog } from './catalog';
import { bearer, json, poll, withQuery } from './http';
import { authorizeUrl, expiresSoon, requireClient, tokenRequest } from './oauth';
import { ProviderError, type OAuthTokens, type Provider } from './types';
import { resolveOptions } from './validate';

const AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const API = 'https://open.tiktokapis.com/v2';
const TOKEN_URL = `${API}/oauth/token/`;
const SCOPE = 'user.info.basic,video.publish';

/** The token is bound to one TikTok user (open_id), so posting needs no extra ids. */
export interface TikTokCredentials extends OAuthTokens {}

/**
 * How long publish() waits for TikTok to fetch and process the media.
 * Mutable so tests can speed it up.
 */
export const tiktokPolling = { intervalMs: 5_000, timeoutMs: 2 * 60_000 };

// ---------------------------------------------------------------------------
// API calls. Every response carries `error.code` ('ok' on success), also on HTTP 200,
// and posting limits arrive as 403, so we map errors by code instead of status.
// ---------------------------------------------------------------------------

const REAUTH_CODES = new Set(['access_token_invalid', 'scope_not_authorized', 'scope_permission_missed', 'auth_removed']);
const RETRYABLE_CODES = new Set(['rate_limit_exceeded', 'spam_risk_too_many_posts', 'reached_active_user_cap', 'internal_error', 'internal', 'video_pull_failed', 'photo_pull_failed']);

const MESSAGES: Record<string, string> = {
  access_token_invalid: 'TikTok access expired. Please reconnect the account.',
  scope_not_authorized: 'TikTok permission to post is missing. Please reconnect the account.',
  auth_removed: 'The app was removed from this TikTok account. Please reconnect it.',
  rate_limit_exceeded: 'TikTok rate limit reached; the post will be retried later.',
  spam_risk_too_many_posts: 'This TikTok account has reached its daily posting limit; the post will be retried later.',
  spam_risk_user_banned_from_posting: 'TikTok does not allow this account to post right now.',
  reached_active_user_cap: 'This app has reached TikTok’s daily limit of posting users; the post will be retried later.',
  unaudited_client_can_only_post_to_private_accounts: 'Until this app passes TikTok’s audit, posts must be set to "Only me".',
  url_ownership_unverified: 'TikTok cannot fetch the media because its domain is not verified in the TikTok developer app.',
  privacy_level_option_mismatch: 'TikTok does not allow the chosen visibility for this account.',
  video_pull_failed: 'TikTok could not download the video; the post will be retried later.',
  photo_pull_failed: 'TikTok could not download the photos; the post will be retried later.',
  file_format_check_failed: 'TikTok does not accept this file format.',
  duration_check_failed: 'The video is too long or too short for this TikTok account.',
  frame_rate_check_failed: 'TikTok does not accept the frame rate of this video.',
  picture_size_check_failed: 'TikTok does not accept the size of these photos.',
};

export function tiktokError(code: string | undefined, message: string | undefined, status = 200): ProviderError {
  const text = (code && MESSAGES[code]) ?? `TikTok: ${message || code || `HTTP ${status}`}`;
  if (code && REAUTH_CODES.has(code)) return new ProviderError(text, { needsReauth: true });
  if (code && RETRYABLE_CODES.has(code)) return new ProviderError(text, { retryable: true });
  if (status === 401) return new ProviderError(text, { needsReauth: true });
  // Unknown 403s are usually posting restrictions, not revoked access, so do not use fromHttpStatus.
  return new ProviderError(text, { retryable: status === 408 || status === 429 || status >= 500 });
}

interface Envelope<T> {
  data?: T;
  error?: { code?: string; message?: string };
}

/** Returns `data` and the raw body (post ids exceed Number.MAX_SAFE_INTEGER and must be read from the text). */
async function call<T>(url: string, token: string, init: RequestInit = {}): Promise<{ data: T; raw: string }> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: { ...init.headers, ...bearer(token) }, signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    throw new ProviderError(`Request to TikTok failed: ${(error as Error).message}`, { retryable: true, cause: error });
  }
  const raw = await response.text().catch(() => '');
  let body: Envelope<T> | undefined;
  try {
    body = JSON.parse(raw) as Envelope<T>;
  } catch {
    if (response.ok) throw new ProviderError('TikTok returned invalid JSON.', { retryable: true });
  }
  if (response.ok && body?.error?.code === 'ok' && body.data) return { data: body.data, raw };
  throw tiktokError(body?.error?.code, body?.error?.message, response.status);
}

const post = <T>(url: string, token: string, body?: unknown) =>
  call<T>(url, token, body === undefined ? { method: 'POST', headers: { 'content-type': 'application/json; charset=UTF-8' } } : json(body));

interface CreatorInfo {
  creator_username: string;
  creator_nickname?: string;
  creator_avatar_url?: string;
  privacy_level_options: string[];
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
  max_video_post_duration_sec?: number;
}

/** Must be queried before every post; it reflects the creator's current settings and posting limits. */
async function creatorInfo(token: string): Promise<CreatorInfo> {
  return (await post<CreatorInfo>(`${API}/post/publish/creator_info/query/`, token)).data;
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

const privacyChoices = catalog.tiktok.capabilities.options.find((option) => option.key === 'privacy')?.choices;
const privacyLabel = (value: string) => privacyChoices?.find((choice) => choice.value === value)?.label ?? value;

interface StatusData {
  status: 'PROCESSING_DOWNLOAD' | 'PROCESSING_UPLOAD' | 'SEND_TO_USER_INBOX' | 'PUBLISH_COMPLETE' | 'FAILED';
  fail_reason?: string;
}

/**
 * Waits for TikTok to finish the post and returns its public id, if any.
 * TikTok only reports the id for public posts that passed moderation.
 * The post is already accepted at this point, so a slow or flaky status check must
 * not fail the publish (a retry would post twice): we stop waiting and return undefined.
 */
async function waitForPost(token: string, publishId: string): Promise<{ postId?: string }> {
  const { intervalMs, timeoutMs } = tiktokPolling;
  const giveUpAt = Date.now() + timeoutMs;
  return poll(
    async () => {
      let result: { data: StatusData; raw: string };
      try {
        result = await post<StatusData>(`${API}/post/publish/status/fetch/`, token, { publish_id: publishId });
      } catch (error) {
        if (!(error instanceof ProviderError && error.retryable)) throw error;
        return Date.now() >= giveUpAt ? {} : undefined;
      }
      const { status, fail_reason: reason } = result.data;
      if (status === 'FAILED') throw tiktokError(reason, `could not publish the post (${reason ?? 'no reason given'})`);
      if (status === 'PUBLISH_COMPLETE') {
        return { postId: /"publicaly_available_post_id"\s*:\s*\[\s*"?(\d+)/.exec(result.raw)?.[1] };
      }
      return Date.now() >= giveUpAt ? {} : undefined;
    },
    // poll's own deadline must never trigger (it throws a retryable error); our giveUpAt ends the loop first.
    { intervalMs, timeoutMs: timeoutMs * 2 + 120_000, what: 'TikTok post' },
  );
}

export const tiktok: Provider<TikTokCredentials> = {
  ...catalog.tiktok,
  connector: {
    kind: 'oauth2',
    // PKCE is only required for TikTok's desktop flow; web apps use client_key + client_secret.
    pkce: false,
    authorizeUrl: (client, { redirectUri, state }) =>
      authorizeUrl(AUTHORIZE_URL, { client_key: client.clientId, response_type: 'code', scope: SCOPE, redirect_uri: redirectUri, state }),
    async exchange(client, { code, redirectUri }) {
      const tokens = await tokenRequest(TOKEN_URL, client, { grant_type: 'authorization_code', code, redirect_uri: redirectUri }, { clientIdParam: 'client_key' });
      const granted = typeof tokens.raw.scope === 'string' ? tokens.raw.scope.split(',') : undefined;
      if (granted && !granted.includes('video.publish')) {
        throw new ProviderError('TikTok permission to post was not granted. Please connect again and allow posting.');
      }
      const { accessToken, refreshToken, expiresAt } = tokens;
      const { data } = await call<{ user: { open_id: string; display_name?: string; avatar_url?: string } }>(
        withQuery(`${API}/user/info/`, { fields: 'open_id,union_id,avatar_url,display_name' }),
        accessToken,
      );
      // The username needs the extra user.info.profile scope on /user/info; creator info returns it with video.publish.
      const creator = await creatorInfo(accessToken);
      return [
        {
          profile: {
            externalId: data.user.open_id,
            handle: `@${creator.creator_username}`,
            displayName: data.user.display_name ?? creator.creator_nickname,
            avatarUrl: data.user.avatar_url ?? creator.creator_avatar_url,
          },
          credentials: { accessToken, refreshToken, expiresAt },
        },
      ];
    },
  },

  validate(content) {
    // Photo posts accept JPEG and WebP only. We can only tell when the type is known.
    const unsupported = content.media.some((item) => item.kind === 'image' && item.mimeType && !/^image\/(jpe?g|webp)$/.test(item.mimeType));
    return unsupported ? ['TikTok photos must be JPEG or WebP.'] : [];
  },

  async publish(credentials, content) {
    const token = credentials.accessToken;
    const { privacy } = resolveOptions(catalog.tiktok, content.options);
    if (!privacy) throw new ProviderError('Choose who can view the TikTok post.');

    const creator = await creatorInfo(token);
    if (!creator.privacy_level_options.includes(privacy)) {
      const allowed = creator.privacy_level_options.map((option) => `"${privacyLabel(option)}"`).join(', ');
      throw new ProviderError(`TikTok does not allow "${privacyLabel(privacy)}" for @${creator.creator_username}. Choose one of: ${allowed}.`);
    }
    // Interactions the creator turned off in TikTok must stay off.
    const interactions = { disable_comment: creator.comment_disabled ?? false };

    // Media is pulled by TikTok from our URLs, which must be on a domain verified in the developer app.
    // TikTok checks the video length against max_video_post_duration_sec itself (duration_check_failed).
    const video = content.media.find((item) => item.kind === 'video');
    const init = video
      ? await post<{ publish_id: string }>(
          `${API}/post/publish/video/init/`,
          token,
          {
            post_info: {
              ...(content.text && { title: content.text }),
              privacy_level: privacy,
              ...interactions,
              disable_duet: creator.duet_disabled ?? false,
              disable_stitch: creator.stitch_disabled ?? false,
            },
            source_info: { source: 'PULL_FROM_URL', video_url: video.url },
          },
        )
      : await post<{ publish_id: string }>(`${API}/post/publish/content/init/`, token, {
          // The photo title is limited to 90 characters, so the text goes into the description.
          post_info: { ...(content.text && { description: content.text }), privacy_level: privacy, ...interactions },
          source_info: { source: 'PULL_FROM_URL', photo_images: content.media.map((item) => item.url), photo_cover_index: 0 },
          post_mode: 'DIRECT_POST',
          media_type: 'PHOTO',
        });

    const publishId = init.data.publish_id;
    const { postId } = await waitForPost(token, publishId);
    // Private posts and posts still in moderation have no public id; the publish id identifies them instead.
    if (!postId) return { remoteId: publishId };
    return { remoteId: postId, url: `https://www.tiktok.com/@${creator.creator_username}/${video ? 'video' : 'photo'}/${postId}` };
  },

  // Access tokens last 24 hours, refresh tokens 365 days.
  needsRefresh: (credentials, now) => expiresSoon(credentials, now),
  async refresh(credentials, client) {
    if (!credentials.refreshToken) throw new ProviderError('TikTok access expired. Please reconnect the account.', { needsReauth: true });
    const tokens = await tokenRequest(
      TOKEN_URL,
      requireClient(client, 'TikTok'),
      { grant_type: 'refresh_token', refresh_token: credentials.refreshToken },
      { clientIdParam: 'client_key' },
    );
    return { ...credentials, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken ?? credentials.refreshToken, expiresAt: tokens.expiresAt };
  },
};
