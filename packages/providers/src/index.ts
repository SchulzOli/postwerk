import { bluesky } from './bluesky';
import { mastodon } from './mastodon';
import { sandbox } from './sandbox';
import type { Provider, ProviderId } from './types';

export * from './types';
export { graphemeLength, mastodonLength } from './text';
export * as Mastodon from './mastodon';
export * as Bluesky from './bluesky';

const providers: Record<ProviderId, Provider<any>> = { mastodon, bluesky, sandbox };

export function getProvider(id: ProviderId): Provider<any> {
  const provider = providers[id];
  if (!provider) throw new Error(`Unknown provider: ${id}`);
  return provider;
}

export function isProviderId(value: string): value is ProviderId {
  return Object.hasOwn(providers, value);
}
