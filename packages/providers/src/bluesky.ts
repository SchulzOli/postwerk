import { AtpAgent, RichText, XRPCError } from '@atproto/api';
import { graphemeLength } from './text';
import { ProviderError, type AccountProfile, type Provider } from './types';

export const BLUESKY_DEFAULT_SERVICE = 'https://bsky.social';
export const BLUESKY_MAX_LENGTH = 300;

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

export async function connect(credentials: BlueskyCredentials): Promise<AccountProfile> {
  if (!isAppPassword(credentials.appPassword)) {
    throw new ProviderError('Please use an app password (Settings → Privacy and security → App passwords), not your main password.');
  }
  const agent = await signIn(credentials);
  const did = agent.session!.did;
  const handle = agent.session!.handle;
  try {
    const { data } = await agent.getProfile({ actor: did });
    return { externalId: did, handle: `@${handle}`, displayName: data.displayName || undefined, avatarUrl: data.avatar };
  } catch {
    return { externalId: did, handle: `@${handle}` };
  }
}

export function postUrl(uri: string, handleOrDid: string): string | undefined {
  // at://did:plc:xyz/app.bsky.feed.post/<rkey>
  const rkey = uri.split('/').pop();
  return rkey ? `https://bsky.app/profile/${handleOrDid}/post/${rkey}` : undefined;
}

export const bluesky: Provider<BlueskyCredentials> = {
  id: 'bluesky',
  name: 'Bluesky',
  validate(content) {
    const issues: string[] = [];
    if (!content.text.trim()) issues.push('Text is empty.');
    const length = graphemeLength(content.text);
    if (length > BLUESKY_MAX_LENGTH) issues.push(`Text is ${length} characters; Bluesky allows ${BLUESKY_MAX_LENGTH}.`);
    return issues;
  },
  async publish(credentials, content) {
    const agent = await signIn(credentials);
    try {
      const richText = new RichText({ text: content.text });
      await richText.detectFacets(agent);
      const result = await agent.post({ text: richText.text, facets: richText.facets });
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
