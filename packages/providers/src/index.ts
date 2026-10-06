import { bluesky } from './bluesky';
import { discord } from './discord';
import { facebook } from './facebook';
import { googleBusiness } from './google-business';
import { instagram } from './instagram';
import { linkedin, linkedinPage } from './linkedin';
import { mastodon } from './mastodon';
import { pinterest } from './pinterest';
import { reddit } from './reddit';
import { sandbox } from './sandbox';
import { telegram } from './telegram';
import { threads } from './threads';
import { tiktok } from './tiktok';
import type { Provider, ProviderId } from './types';
import { x } from './x';
import { youtube } from './youtube';

export * from './types';
export * from './catalog';
export { countText, graphemeLength, mastodonLength, xLength } from './text';
export { formatBytes, validateContent, resolveOptions, textLimit } from './validate';
export { localizeFields, localizeInfo, validationMessages } from './messages';
export * from './i18n';
export { codeChallenge, generateCodeVerifier } from './oauth';
export * as Mastodon from './mastodon';
export * as Bluesky from './bluesky';
export * as Atproto from './atproto';

const providers: Record<ProviderId, Provider> = {
  mastodon,
  bluesky,
  facebook,
  instagram,
  threads,
  linkedin,
  linkedin_page: linkedinPage,
  x,
  tiktok,
  youtube,
  pinterest,
  reddit,
  google_business: googleBusiness,
  telegram,
  discord,
  sandbox,
};

export function getProvider(id: ProviderId): Provider {
  const provider = providers[id];
  if (!provider) throw new Error(`Unknown provider: ${id}`);
  return provider;
}

export function isProviderId(value: string): value is ProviderId {
  return Object.hasOwn(providers, value);
}
