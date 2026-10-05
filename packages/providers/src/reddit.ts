import { catalog } from './catalog';
import { basicAuth, bearer, form, requestJson } from './http';
import { authorizeUrl, expiresSoon, requireClient, tokensFrom } from './oauth';
import { ProviderError, type OAuthClient, type OAuthTokens, type PostContent, type Provider } from './types';
import { resolveOptions } from './validate';

const AUTHORIZE_URL = 'https://www.reddit.com/api/v1/authorize';
const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const API = 'https://oauth.reddit.com';
const SCOPE = 'identity submit';
/** Reddit throttles or blocks requests without a descriptive user agent. */
export const REDDIT_USER_AGENT = 'web:postwerk:v0.1 (by /u/postwerk)';

/** Posts need nothing beyond the token: the subreddit is chosen per post. */
export type RedditCredentials = OAuthTokens;

const headers = (token: string) => ({ ...bearer(token), 'user-agent': REDDIT_USER_AGENT });

/** Accepts "physiotherapy", "r/physiotherapy" or "/r/physiotherapy". */
export function normalizeSubreddit(value: string): string {
  return value.trim().replace(/^\/?r\//i, '');
}

/** Reddit HTML-escapes URLs in JSON (`&amp;` in avatar query strings). */
function unescapeHtml(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|#39);/g, (_, entity: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[entity]!);
}

/**
 * Like `tokenRequest`, but with the user agent Reddit requires. Reddit also
 * reports a rejected code as 200 with an `error` field.
 */
async function redditToken(client: OAuthClient, params: Record<string, string>): Promise<OAuthTokens> {
  const response = await requestJson<{ access_token?: string; refresh_token?: string; expires_in?: number; error?: string }>(
    TOKEN_URL,
    form(params, { ...basicAuth(client.clientId, client.clientSecret), 'user-agent': REDDIT_USER_AGENT }),
  ).catch((error: unknown) => {
    if (error instanceof ProviderError && !error.retryable) throw new ProviderError(error.message, { needsReauth: true, cause: error });
    throw error;
  });
  if (!response.access_token) {
    throw new ProviderError(`Reddit did not grant access${response.error ? ` (${response.error})` : ''}. Please connect the account again.`, { needsReauth: true });
  }
  return tokensFrom({ ...response, access_token: response.access_token });
}

type RedditError = [code: string, message: string, field?: string];

interface SubmitResponse {
  json?: { errors?: RedditError[]; data?: { id?: string; name?: string; url?: string } };
}

async function publish(credentials: RedditCredentials, content: PostContent) {
  const options = resolveOptions(catalog.reddit, content.options);
  const response = await requestJson<SubmitResponse>(
    `${API}/api/submit`,
    form(
      {
        sr: normalizeSubreddit(options.subreddit ?? ''),
        kind: 'self',
        title: options.title,
        text: content.text,
        api_type: 'json',
        resubmit: true,
      },
      headers(credentials.accessToken),
    ),
  );

  // Failed submissions still answer 200; the reasons are in json.errors.
  const errors = response.json?.errors ?? [];
  if (errors.length > 0) {
    const message = errors.map(([code, text]) => text || code).join('; ');
    throw new ProviderError(`Reddit rejected the post: ${message}`, { retryable: errors.some(([code]) => code === 'RATELIMIT') });
  }
  const data = response.json?.data;
  const remoteId = data?.name ?? data?.id;
  if (!remoteId) throw new ProviderError('Reddit did not return the id of the new post.');
  return { remoteId, url: data?.url };
}

async function refresh(credentials: RedditCredentials, client: OAuthClient | undefined): Promise<RedditCredentials> {
  if (!credentials.refreshToken) throw new ProviderError('Reddit access expired. Please reconnect the account.', { needsReauth: true });
  const tokens = await redditToken(requireClient(client, 'Reddit'), { grant_type: 'refresh_token', refresh_token: credentials.refreshToken });
  return { ...credentials, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken ?? credentials.refreshToken, expiresAt: tokens.expiresAt };
}

export const reddit: Provider<RedditCredentials> = {
  ...catalog.reddit,
  connector: {
    kind: 'oauth2',
    pkce: false,
    authorizeUrl: (client, { redirectUri, state }) =>
      // duration=permanent asks for a refresh token; access tokens last one hour.
      authorizeUrl(AUTHORIZE_URL, { client_id: client.clientId, response_type: 'code', state, redirect_uri: redirectUri, duration: 'permanent', scope: SCOPE }),
    async exchange(client, { code, redirectUri }) {
      const tokens = await redditToken(client, { grant_type: 'authorization_code', code, redirect_uri: redirectUri });
      const me = await requestJson<{ id: string; name: string; icon_img?: string }>(`${API}/api/v1/me`, { headers: headers(tokens.accessToken) });
      return [
        {
          profile: { externalId: me.id, handle: `u/${me.name}`, displayName: me.name, avatarUrl: me.icon_img ? unescapeHtml(me.icon_img) : undefined },
          credentials: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt },
        },
      ];
    },
  },
  validate(content) {
    const subreddit = resolveOptions(catalog.reddit, content.options).subreddit;
    if (subreddit && !/^[A-Za-z0-9_]{2,21}$/.test(normalizeSubreddit(subreddit))) return ['Subreddit must be a name like "physiotherapy".'];
    return [];
  },
  publish: (credentials, content) => publish(credentials, content),
  needsRefresh: (credentials, now) => expiresSoon(credentials, now),
  refresh,
};
