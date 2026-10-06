import { basicAuth, form, requestJson, withQuery } from './http';
import { ProviderError, type OAuthClient, type OAuthTokens, type ProviderClient } from './types';

export function authorizeUrl(base: string, params: Record<string, string | undefined>): string {
  return withQuery(base, params);
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number | string;
}

/**
 * Standard OAuth 2.0 token request (authorization_code or refresh_token grant).
 * `clientAuth: 'basic'` sends the client credentials as HTTP Basic auth instead of in the body.
 */
export async function tokenRequest(
  tokenUrl: string,
  client: OAuthClient,
  params: Record<string, string | undefined>,
  options: { clientAuth?: 'body' | 'basic'; clientIdParam?: string; clientSecretParam?: string } = {},
): Promise<OAuthTokens & { raw: Record<string, unknown> }> {
  const { clientAuth = 'body', clientIdParam = 'client_id', clientSecretParam = 'client_secret' } = options;
  const body = clientAuth === 'body' ? { ...params, [clientIdParam]: client.clientId, [clientSecretParam]: client.clientSecret } : params;
  const headers = clientAuth === 'basic' ? basicAuth(client.clientId, client.clientSecret) : {};
  const response = await requestJson<TokenResponse & Record<string, unknown>>(tokenUrl, form(body, headers)).catch((error: unknown) => {
    // A rejected code or refresh token means the user has to connect again.
    if (error instanceof ProviderError && !error.retryable) throw new ProviderError(error.message, { needsReauth: true, cause: error });
    throw error;
  });
  if (!response.access_token) {
    const reason = [response.error_description, response.error].find((value) => typeof value === 'string');
    throw new ProviderError(reason ? `Sign-in was rejected: ${reason}` : 'Token response did not contain an access token.', { needsReauth: true });
  }
  return { ...tokensFrom(response), raw: response };
}

export function tokensFrom(response: TokenResponse, now = Date.now()): OAuthTokens {
  const expiresIn = response.expires_in === undefined ? undefined : Number(response.expires_in);
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresAt: expiresIn ? now + expiresIn * 1000 : undefined,
  };
}

/** True when the token expires within `marginMs` (default 5 minutes). Tokens without expiry never need refreshing. */
export function expiresSoon(tokens: Pick<OAuthTokens, 'expiresAt'>, now: number, marginMs = 5 * 60_000): boolean {
  return tokens.expiresAt !== undefined && tokens.expiresAt - marginMs <= now;
}

export function requireClient(client: ProviderClient | undefined, provider: string): OAuthClient {
  if (!client || !('clientId' in client)) throw new ProviderError(`${provider} is not configured on this server.`, { retryable: true });
  return client;
}

/** PKCE helpers (RFC 7636, S256). */
export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
