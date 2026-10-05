import { request, requestJson, type RequestOptions } from './http';
import { authorizeUrl, requireClient, tokenRequest } from './oauth';
import { ProviderError, type ConnectedAccount, type OAuthClient, type OAuthConnect, type OAuthTokens } from './types';

/**
 * Google OAuth and API helpers shared by YouTube and Google Business Profile.
 * Both use the same operator app (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).
 */

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * OAuth connector for a Google API. `access_type=offline` + `prompt=consent`
 * make Google return a refresh token on every connect, not only the first one.
 */
export function googleConnector<C extends OAuthTokens>(
  name: string,
  scope: string,
  listAccounts: (tokens: OAuthTokens) => Promise<ConnectedAccount<C>[]>,
): OAuthConnect<C> {
  return {
    kind: 'oauth2',
    pkce: false,
    authorizeUrl: (client, { redirectUri, state }) =>
      authorizeUrl(AUTHORIZE_URL, {
        client_id: client.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        state,
        scope,
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
      }),
    async exchange(client, { code, redirectUri }) {
      const tokens = await tokenRequest(GOOGLE_TOKEN_URL, client, { grant_type: 'authorization_code', code, redirect_uri: redirectUri });
      // Google's consent screen lets users untick individual scopes.
      const granted = typeof tokens.raw.scope === 'string' ? tokens.raw.scope.split(' ') : undefined;
      if (granted && scope.split(' ').some((needed) => !granted.includes(needed))) {
        throw new ProviderError(`${name} needs every permission on the Google consent screen. Please connect again and keep all boxes ticked.`);
      }
      return listAccounts({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt });
    },
  };
}

/** Access tokens last one hour. A revoked refresh token yields `invalid_grant`, which tokenRequest turns into needsReauth. */
export async function refreshGoogleTokens<C extends OAuthTokens>(credentials: C, client: OAuthClient | undefined, name: string): Promise<C> {
  if (!credentials.refreshToken) throw new ProviderError(`${name} access expired. Please reconnect the account.`, { needsReauth: true });
  const tokens = await tokenRequest(GOOGLE_TOKEN_URL, requireClient(client, name), {
    grant_type: 'refresh_token',
    refresh_token: credentials.refreshToken,
  });
  return { ...credentials, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken ?? credentials.refreshToken, expiresAt: tokens.expiresAt };
}

interface GoogleErrorBody {
  error?: {
    message?: string;
    status?: string;
    /** Classic APIs (YouTube Data, My Business v4). */
    errors?: { reason?: string }[];
    /** Newer APIs put google.rpc.ErrorInfo here. */
    details?: { reason?: string }[];
  };
}

/** Quota and rate limits arrive as 403 on classic APIs; they clear on their own, so retry instead of asking for a reconnect. */
const QUOTA_REASONS = new Set(['quotaExceeded', 'uploadLimitExceeded', 'rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded', 'RATE_LIMIT_EXCEEDED']);
/** The operator has not enabled the API in their Google Cloud project; reconnecting would not help. */
const DISABLED_REASONS = new Set(['accessNotConfigured', 'SERVICE_DISABLED']);

export function googleError(status: number, body: string, name: string): ProviderError {
  let parsed: GoogleErrorBody = {};
  try {
    parsed = JSON.parse(body) as GoogleErrorBody;
  } catch {
    // Not JSON (e.g. an HTML error page); fall back to the status code.
  }
  const reasons = [...(parsed.error?.errors ?? []), ...(parsed.error?.details ?? [])].map((entry) => entry.reason ?? '');
  // Messages sometimes contain HTML links ("exceeded your <a href=…>quota</a>").
  const detail = (parsed.error?.message ?? body.slice(0, 200)).replace(/<[^>]+>/g, '').trim() || `HTTP ${status}`;
  const reason = reasons.find((entry) => QUOTA_REASONS.has(entry));
  if (reason || parsed.error?.status === 'RESOURCE_EXHAUSTED') {
    const what = reason === 'uploadLimitExceeded' ? 'daily upload limit' : 'API quota';
    return new ProviderError(`${name} ${what} reached for now; the post will be retried later. (${detail})`, { retryable: true });
  }
  if (reasons.some((entry) => DISABLED_REASONS.has(entry))) {
    return new ProviderError(`The ${name} API is not enabled in this server's Google Cloud project. (${detail})`);
  }
  return ProviderError.fromHttpStatus(status, `${name}: ${detail}`);
}

/**
 * Like `request`, but reads Google's error reasons first so quota errors
 * (HTTP 403) are retried instead of being treated as revoked access.
 */
export function googleRequest(url: string, init: RequestOptions, name: string): Promise<Response> {
  return request(url, { ...init, mapError: (status, body) => googleError(status, body, name) });
}

export function googleJson<T>(url: string, init: RequestOptions, name: string): Promise<T> {
  return requestJson<T>(url, { ...init, mapError: (status, body) => googleError(status, body, name) });
}
