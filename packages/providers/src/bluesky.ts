import { AtpAgent, RichText, XRPCError } from '@atproto/api';
import { catalog } from './catalog';
import { downloadMedia } from './http';
import { ProviderError, type ConnectedAccount, type Provider } from './types';

export const BLUESKY_DEFAULT_SERVICE = 'https://bsky.social';
export const BLUESKY_MAX_LENGTH = catalog.bluesky.capabilities.text.maxLength;
const MAX_IMAGE_BYTES = 1_000_000;

const APP_PASSWORD_PATTERN = /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i;

/**
 * Bluesky needs no developer app at all: users create an app password in
 * their settings and we sign in with it. It can be revoked at any time
 * without touching the main password.
 */
export interface BlueskyCredentials {
  service: string;
  identifier: string;
  appPassword: string;
}

export function isAppPassword(value: string): boolean {
  return APP_PASSWORD_PATTERN.test(value.trim());
}

export function normalizeHandle(input: string): string {
  return input.trim().replace(/^@/, '');
}

async function signIn(credentials: BlueskyCredentials): Promise<AtpAgent> {
  const agent = new AtpAgent({ service: credentials.service });
  try {
    await agent.login({ identifier: credentials.identifier, password: credentials.appPassword });
  } catch (error) {
    throw toProviderError(error, 'Bluesky sign-in failed');
  }
  return agent;
}

export async function connect(credentials: BlueskyCredentials): Promise<ConnectedAccount<BlueskyCredentials>> {
  if (!credentials.identifier) throw new ProviderError('Please enter your Bluesky handle.');
  if (!isAppPassword(credentials.appPassword)) {
    throw new ProviderError('Please use an app password (Settings → Privacy and security → App passwords), not your main password.');
  }
  const agent = await signIn(credentials);
  const did = agent.session!.did;
  const handle = agent.session!.handle;
  const limits = { maxLength: BLUESKY_MAX_LENGTH };
  try {
    const { data } = await agent.getProfile({ actor: did });
    return { profile: { externalId: did, handle: `@${handle}`, displayName: data.displayName || undefined, avatarUrl: data.avatar }, credentials, limits };
  } catch {
    return { profile: { externalId: did, handle: `@${handle}` }, credentials, limits };
  }
}

export function postUrl(uri: string, handleOrDid: string): string | undefined {
  // at://did:plc:xyz/app.bsky.feed.post/<rkey>
  const rkey = uri.split('/').pop();
  return rkey ? `https://bsky.app/profile/${handleOrDid}/post/${rkey}` : undefined;
}

export const bluesky: Provider<BlueskyCredentials> = {
  ...catalog.bluesky,
  connector: {
    kind: 'form',
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
  async publish(credentials, content) {
    const agent = await signIn(credentials);
    try {
      const images = [];
      for (const item of content.media) {
        const { blob, mimeType } = await downloadMedia(item.url, MAX_IMAGE_BYTES);
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
      return { remoteId: result.uri, url: postUrl(result.uri, agent.session!.handle) };
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
