import { Agent, AtpAgent, RichText, XRPCError } from '@atproto/api';
import { atprotoNetwork, finishLogin, refreshSession, sessionFetcher, type AtprotoSession, type PendingLogin } from './atproto';
import { catalog } from './catalog';
import { fetchMedia, requestJson, withQuery } from './http';
import { expiresSoon } from './oauth';
import { ProviderError, type AccountProfile, type ConnectedAccount, type Provider, type ProviderClient } from './types';

export const BLUESKY_DEFAULT_SERVICE = 'https://bsky.social';
export const BLUESKY_MAX_LENGTH = catalog.bluesky.capabilities.text.maxLength;
const MAX_IMAGE_BYTES = 1_000_000;

const APP_PASSWORD_PATTERN = /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i;

/**
 * Signed in with an app password: users create one in their settings, and it
 * can be revoked at any time without touching the main password.
 */
export interface BlueskyAppPassword {
  kind?: 'app-password';
  service: string;
  identifier: string;
  appPassword: string;
}

/** Signed in with OAuth on the user's own server. */
export interface BlueskyOAuth extends AtprotoSession {
  kind: 'oauth';
}

export type BlueskyCredentials = BlueskyAppPassword | BlueskyOAuth;

const isOAuth = (credentials: BlueskyCredentials): credentials is BlueskyOAuth => credentials.kind === 'oauth';

export function isAppPassword(value: string): boolean {
  return APP_PASSWORD_PATTERN.test(value.trim());
}

export function normalizeHandle(input: string): string {
  return input.trim().replace(/^@/, '');
}

async function signIn(credentials: BlueskyAppPassword): Promise<AtpAgent> {
  const agent = new AtpAgent({ service: credentials.service });
  try {
    await agent.login({ identifier: credentials.identifier, password: credentials.appPassword });
  } catch (error) {
    throw toProviderError(error, 'Bluesky sign-in failed');
  }
  return agent;
}

/** Public profile from the AppView (no sign-in needed); falls back to the bare handle. */
async function profileOf(did: string, handle: string | undefined): Promise<AccountProfile> {
  try {
    const profile = await requestJson<{ handle?: string; displayName?: string; avatar?: string }>(
      withQuery(`${atprotoNetwork.appView}/xrpc/app.bsky.actor.getProfile`, { actor: did }),
      { timeoutMs: 10_000 },
    );
    const verified = profile.handle && profile.handle !== 'handle.invalid' ? profile.handle : handle;
    return { externalId: did, handle: `@${verified ?? did}`, displayName: profile.displayName || undefined, avatarUrl: profile.avatar };
  } catch {
    return { externalId: did, handle: `@${handle ?? did}` };
  }
}

export async function connect(credentials: BlueskyAppPassword): Promise<ConnectedAccount<BlueskyAppPassword>> {
  if (!credentials.identifier) throw new ProviderError('Please enter your Bluesky handle.', { de: 'Bitte gib dein Bluesky-Handle ein.' });
  if (!isAppPassword(credentials.appPassword)) {
    throw new ProviderError('Please use an app password (Settings → Privacy and security → App passwords), not your main password.', {
      de: 'Bitte verwende ein App-Passwort (Einstellungen → Datenschutz und Sicherheit → App-Passwörter), nicht dein Hauptpasswort.',
    });
  }
  const agent = await signIn(credentials);
  const { did, handle } = agent.session!;
  return { profile: await profileOf(did, handle), credentials, limits: { maxLength: BLUESKY_MAX_LENGTH } };
}

/** Finishes an OAuth sign-in (see `startLogin` in ./atproto) and describes the account. */
export async function connectOAuth(keys: ProviderClient | undefined, pending: PendingLogin, params: { code: string; iss: string | null }): Promise<ConnectedAccount<BlueskyOAuth>> {
  const session = await finishLogin(keysOf(keys), pending, params);
  return { profile: await profileOf(session.did, session.handle), credentials: { kind: 'oauth', ...session }, limits: { maxLength: BLUESKY_MAX_LENGTH } };
}

const keysOf = (client: ProviderClient | undefined) => (client && 'keys' in client ? client.keys : []);

export function postUrl(uri: string, handleOrDid: string): string | undefined {
  // at://did:plc:xyz/app.bsky.feed.post/<rkey>
  const rkey = uri.split('/').pop();
  return rkey ? `https://bsky.app/profile/${handleOrDid}/post/${rkey}` : undefined;
}

export const bluesky: Provider<BlueskyCredentials> = {
  ...catalog.bluesky,
  connector: {
    kind: 'atproto',
    // The app password form; signing in with OAuth starts on the user's server.
    fields: [
      { name: 'handle', label: 'Handle', placeholder: 'you.bsky.social' },
      {
        name: 'appPassword',
        label: 'App password',
        type: 'password',
        placeholder: 'xxxx-xxxx-xxxx-xxxx',
        hint: 'Create one at bsky.app → Settings → Privacy and security → App passwords.',
      },
    ],
    async connect(values) {
      const credentials = {
        service: BLUESKY_DEFAULT_SERVICE,
        identifier: normalizeHandle(values.handle ?? ''),
        appPassword: (values.appPassword ?? '').trim(),
      };
      return [await connect(credentials)];
    },
  },
  // OAuth access tokens live minutes; refresh shortly before they run out.
  needsRefresh: (credentials, now) => isOAuth(credentials) && expiresSoon(credentials, now, 60_000),
  async refresh(credentials, client) {
    if (!isOAuth(credentials)) return credentials;
    return { ...(await refreshSession(credentials, keysOf(client))), kind: 'oauth' };
  },
  async publish(credentials, content, context) {
    const agent = isOAuth(credentials) ? new Agent(sessionFetcher(credentials)) : await signIn(credentials);
    try {
      const images = [];
      for (const item of content.media) {
        const { blob, mimeType } = await fetchMedia(item, context, MAX_IMAGE_BYTES);
        const { data } = await agent.uploadBlob(new Uint8Array(await blob.arrayBuffer()), { encoding: mimeType });
        images.push({ image: data.blob, alt: item.altText ?? '' });
      }
      const richText = new RichText({ text: content.text });
      await richText.detectFacets(agent);
      const result = await agent.post({
        text: richText.text,
        facets: richText.facets,
        ...(images.length > 0 && { embed: { $type: 'app.bsky.embed.images', images } }),
      });
      // The DID never changes; handles can.
      return { remoteId: result.uri, url: postUrl(result.uri, isOAuth(credentials) ? credentials.did : (agent as AtpAgent).session!.handle) };
    } catch (error) {
      throw toProviderError(error, 'Bluesky post failed');
    }
  },
};

function toProviderError(error: unknown, prefix: string): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof XRPCError) {
    const message = `${prefix}: ${error.message || error.error}`;
    // Status codes below 100 are client-side failures (network, timeout).
    if (error.status < 100) return new ProviderError(message, { retryable: true, cause: error });
    return ProviderError.fromHttpStatus(error.status, message);
  }
  return new ProviderError(`${prefix}: ${(error as Error).message}`, { retryable: true, cause: error });
}
