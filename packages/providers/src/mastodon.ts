import { requestJson } from './http';
import { mastodonLength } from './text';
import { ProviderError, type AccountProfile, type Provider } from './types';

export const MASTODON_SCOPES = 'read:accounts write:statuses write:media';
export const MASTODON_DEFAULT_MAX_LENGTH = 500;

export interface MastodonCredentials {
  instanceUrl: string;
  accessToken: string;
}

export interface MastodonApp {
  clientId: string;
  clientSecret: string;
}

/** Normalizes user input like "mastodon.social" or "https://mastodon.social/" to an origin. */
export function normalizeInstanceUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new ProviderError('Please enter a Mastodon server.');
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new ProviderError(`"${input}" is not a valid server address.`);
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new ProviderError('Mastodon servers must use https.');
  }
  return url.origin;
}

/**
 * Mastodon lets any client register itself on any server, so users never
 * need to create a developer app: we register one per server on demand.
 */
export async function registerApp(instanceUrl: string, redirectUri: string, appName: string, website?: string): Promise<MastodonApp> {
  const app = await requestJson<{ client_id: string; client_secret: string }>(`${instanceUrl}/api/v1/apps`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: appName, redirect_uris: redirectUri, scopes: MASTODON_SCOPES, website }),
  });
  return { clientId: app.client_id, clientSecret: app.client_secret };
}

export function authorizeUrl(instanceUrl: string, app: MastodonApp, redirectUri: string, state: string): string {
  const url = new URL('/oauth/authorize', instanceUrl);
  url.search = new URLSearchParams({
    client_id: app.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: MASTODON_SCOPES,
    state,
  }).toString();
  return url.toString();
}

export async function exchangeCode(instanceUrl: string, app: MastodonApp, redirectUri: string, code: string): Promise<string> {
  const token = await requestJson<{ access_token: string }>(`${instanceUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: app.clientId,
      client_secret: app.clientSecret,
      redirect_uri: redirectUri,
      code,
      scope: MASTODON_SCOPES,
    }),
  });
  return token.access_token;
}

export async function fetchProfile(credentials: MastodonCredentials): Promise<AccountProfile> {
  const account = await requestJson<{ id: string; acct: string; display_name: string; avatar: string }>(
    `${credentials.instanceUrl}/api/v1/accounts/verify_credentials`,
    { headers: { authorization: `Bearer ${credentials.accessToken}` } },
  );
  const host = new URL(credentials.instanceUrl).host;
  return {
    externalId: `${host}:${account.id}`,
    handle: `@${account.acct}@${host}`,
    displayName: account.display_name || undefined,
    avatarUrl: account.avatar || undefined,
  };
}

/** Reads the server's post length limit; falls back to Mastodon's default. */
export async function fetchMaxLength(instanceUrl: string): Promise<number> {
  try {
    const instance = await requestJson<{ configuration?: { statuses?: { max_characters?: number } } }>(
      `${instanceUrl}/api/v2/instance`,
    );
    return instance.configuration?.statuses?.max_characters ?? MASTODON_DEFAULT_MAX_LENGTH;
  } catch {
    return MASTODON_DEFAULT_MAX_LENGTH;
  }
}

export const mastodon: Provider<MastodonCredentials> = {
  id: 'mastodon',
  name: 'Mastodon',
  validate(content, limits) {
    const max = limits?.maxLength ?? MASTODON_DEFAULT_MAX_LENGTH;
    const issues: string[] = [];
    if (!content.text.trim()) issues.push('Text is empty.');
    const length = mastodonLength(content.text);
    if (length > max) issues.push(`Text is ${length} characters; this server allows ${max}.`);
    return issues;
  },
  async publish(credentials, content, context) {
    const status = await requestJson<{ id: string; url: string | null }>(`${credentials.instanceUrl}/api/v1/statuses`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${credentials.accessToken}`,
        'content-type': 'application/json',
        'idempotency-key': context.idempotencyKey,
      },
      body: JSON.stringify({ status: content.text, visibility: 'public' }),
    });
    return { remoteId: status.id, url: status.url ?? undefined };
  },
};
