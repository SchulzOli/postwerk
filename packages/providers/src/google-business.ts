import { catalog } from './catalog';
import { googleConnector, googleJson, refreshGoogleTokens } from './google';
import { bearer, json, withQuery } from './http';
import { expiresSoon } from './oauth';
import { ProviderError, type ConnectedAccount, type OAuthTokens, type Provider } from './types';

const ACCOUNTS_API = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const LOCATIONS_API = 'https://mybusinessbusinessinformation.googleapis.com/v1';
/** Local posts only exist in the legacy v4 API. */
const POSTS_API = 'https://mybusiness.googleapis.com/v4';
const SCOPE = 'https://www.googleapis.com/auth/business.manage';
const NAME = 'Google Business Profile';

/** Used when Google does not report a language for the location. */
const DEFAULT_LANGUAGE = 'de';

export interface GoogleBusinessCredentials extends OAuthTokens {
  /** accounts/{accountId}/locations/{locationId}, the v4 path posts are created under. */
  location: string;
  /** BCP 47 language of the location; local posts require one. */
  languageCode: string;
}

interface Location {
  /** locations/{locationId} */
  name: string;
  title?: string;
  languageCode?: string;
  storefrontAddress?: { addressLines?: string[]; locality?: string };
}

/** Follows `nextPageToken` until every page is read. */
async function listAll<T>(url: string, token: string, key: string, params: Record<string, string | number> = {}): Promise<T[]> {
  const items: T[] = [];
  let pageToken: string | undefined;
  do {
    const page = await googleJson<Record<string, unknown> & { nextPageToken?: string }>(withQuery(url, { ...params, pageToken }), { headers: bearer(token) }, NAME);
    items.push(...((page[key] as T[] | undefined) ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return items;
}

async function listLocations(tokens: OAuthTokens): Promise<ConnectedAccount<GoogleBusinessCredentials>[]> {
  const accounts = await listAll<{ name: string }>(`${ACCOUNTS_API}/accounts`, tokens.accessToken, 'accounts', { pageSize: 20 });
  const result: ConnectedAccount<GoogleBusinessCredentials>[] = [];
  const seen = new Set<string>();
  for (const account of accounts) {
    const locations = await listAll<Location>(`${LOCATIONS_API}/${account.name}/locations`, tokens.accessToken, 'locations', {
      readMask: 'name,title,languageCode,storefrontAddress',
      pageSize: 100,
    });
    for (const location of locations) {
      // A location shared through a location group shows up under several accounts.
      if (seen.has(location.name)) continue;
      seen.add(location.name);
      const address = location.storefrontAddress;
      const handle = [address?.addressLines?.[0], address?.locality].filter(Boolean).join(', ');
      result.push({
        profile: { externalId: location.name, handle: handle || location.title || location.name, displayName: location.title },
        credentials: { ...tokens, location: `${account.name}/${location.name}`, languageCode: location.languageCode ?? DEFAULT_LANGUAGE },
      });
    }
  }
  if (result.length === 0) throw new ProviderError('No Business Profile locations found for this Google account.');
  return result;
}

export const googleBusiness: Provider<GoogleBusinessCredentials> = {
  ...catalog.google_business,
  connector: googleConnector<GoogleBusinessCredentials>(NAME, SCOPE, listLocations),

  async publish(credentials, content) {
    // Google fetches the photo itself; it must be publicly reachable.
    const photo = content.media.find((item) => item.kind === 'image');
    const post = await googleJson<{ name?: string; searchUrl?: string }>(
      `${POSTS_API}/${credentials.location}/localPosts`,
      json(
        {
          languageCode: credentials.languageCode,
          summary: content.text,
          topicType: 'STANDARD',
          ...(photo && { media: [{ mediaFormat: 'PHOTO', sourceUrl: photo.url }] }),
        },
        bearer(credentials.accessToken),
      ),
      NAME,
    );
    if (!post.name) throw new ProviderError('Google did not return the id of the new post.');
    return { remoteId: post.name, url: post.searchUrl };
  },

  needsRefresh: (credentials, now) => expiresSoon(credentials, now),
  refresh: (credentials, client) => refreshGoogleTokens(credentials, client, NAME),
};
