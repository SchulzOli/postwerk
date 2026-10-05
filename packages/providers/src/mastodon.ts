import { catalog } from './catalog';
import { bearer, downloadMedia, json, poll, requestJson } from './http';
import { ProviderError, type AccountProfile, type MediaItem, type Provider } from './types';

export const MASTODON_SCOPES = 'read:accounts write:statuses write:media';
export const MASTODON_DEFAULT_MAX_LENGTH = catalog.mastodon.capabilities.text.maxLength;

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
  const app = await requestJson<{ client_id: string; client_secret: string }>(
    `${instanceUrl}/api/v1/apps`,
    json({ client_name: appName, redirect_uris: redirectUri, scopes: MASTODON_SCOPES, website }),
  );
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
  const token = await requestJson<{ access_token: string }>(
    `${instanceUrl}/oauth/token`,
    json({
      grant_type: 'authorization_code',
      client_id: app.clientId,
      client_secret: app.clientSecret,
      redirect_uri: redirectUri,
      code,
      scope: MASTODON_SCOPES,
    }),
  );
  return token.access_token;
}

export async function fetchProfile(credentials: MastodonCredentials): Promise<AccountProfile> {
  const account = await requestJson<{ id: string; acct: string; display_name: string; avatar: string }>(
    `${credentials.instanceUrl}/api/v1/accounts/verify_credentials`,
    { headers: bearer(credentials.accessToken) },
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
    const instance = await requestJson<{ configuration?: { statuses?: { max_characters?: number } } }>(`${instanceUrl}/api/v2/instance`);
    return instance.configuration?.statuses?.max_characters ?? MASTODON_DEFAULT_MAX_LENGTH;
  } catch {
    return MASTODON_DEFAULT_MAX_LENGTH;
  }
}

interface MastodonMedia {
  id: string;
  url: string | null;
}

async function uploadMedia(credentials: MastodonCredentials, item: MediaItem): Promise<string> {
  const { blob } = await downloadMedia(item.url);
  const body = new FormData();
  body.set('file', blob, item.kind === 'video' ? 'video' : 'image');
  if (item.altText) body.set('description', item.altText);
  const media = await requestJson<MastodonMedia>(`${credentials.instanceUrl}/api/v2/media`, {
    method: 'POST',
    headers: bearer(credentials.accessToken),
    body,
    timeoutMs: 120_000,
  });
  if (media.url) return media.id;
  // Large files are processed asynchronously; the status cannot reference them until they are ready.
  return poll(
    async () => {
      const current = await requestJson<MastodonMedia>(`${credentials.instanceUrl}/api/v1/media/${media.id}`, {
        headers: bearer(credentials.accessToken),
      });
      return current.url ? current.id : undefined;
    },
    { what: 'Mastodon media' },
  );
}

export const mastodon: Provider<MastodonCredentials> = {
  ...catalog.mastodon,
  connector: { kind: 'mastodon' },
  async publish(credentials, content, context) {
    const mediaIds: string[] = [];
    for (const item of content.media) mediaIds.push(await uploadMedia(credentials, item));
    const status = await requestJson<{ id: string; url: string | null }>(
      `${credentials.instanceUrl}/api/v1/statuses`,
      json(
        { status: content.text, media_ids: mediaIds, visibility: 'public' },
        { ...bearer(credentials.accessToken), 'idempotency-key': context.idempotencyKey },
      ),
    );
    return { remoteId: status.id, url: status.url ?? undefined };
  },
};
