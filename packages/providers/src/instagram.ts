import { catalog } from './catalog';
import { form } from './http';
import { asReauth, GRAPH_VERSION, graphApi, graphRequest, LONG_LIVED_SECONDS, waitForContainer, type MetaTokenResponse } from './meta';
import { authorizeUrl, expiresSoon } from './oauth';
import { ProviderError, type MediaItem, type OAuthTokens, type PostContent, type Provider, type PublishResult } from './types';

const AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize';
const TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const GRAPH = 'https://graph.instagram.com';
const SCOPE = 'instagram_business_basic,instagram_business_content_publish';
const api = graphApi('Instagram', `${GRAPH}/${GRAPH_VERSION}`);

const MAX_CAROUSEL = 10;
const MAX_HASHTAGS = 30;
/** Long-lived tokens last 60 days and can be extended once they are a day old; renew in the last week. */
const REFRESH_MARGIN_MS = 7 * 24 * 60 * 60_000;

export interface InstagramCredentials extends OAuthTokens {
  /** Instagram professional account id (`user_id` from /me). */
  userId: string;
}

function tokenFields(response: MetaTokenResponse, now = Date.now()): OAuthTokens {
  return { accessToken: response.access_token, expiresAt: now + (response.expires_in ?? LONG_LIVED_SECONDS) * 1000 };
}

async function exchangeCode(client: { clientId: string; clientSecret: string }, code: string, redirectUri: string): Promise<string> {
  // The docs show the token wrapped in `data: [...]`; the live API returns it flat. Accept both.
  const response = await graphRequest<MetaTokenResponse & { data?: MetaTokenResponse[] }>(
    'Instagram',
    TOKEN_URL,
    form({ client_id: client.clientId, client_secret: client.clientSecret, grant_type: 'authorization_code', redirect_uri: redirectUri, code }),
  );
  const token = response.data?.[0]?.access_token ?? response.access_token;
  if (!token) throw new ProviderError('Instagram did not return an access token.', { needsReauth: true });
  return token;
}

/** Creates a media container and returns its id. */
function createContainer(credentials: InstagramCredentials, params: Record<string, string | boolean | undefined>): Promise<string> {
  return api
    .post<{ id: string }>(`/${credentials.userId}/media`, { ...params, access_token: credentials.accessToken })
    .then((container) => container.id);
}

/** Video containers are processed asynchronously and cannot be used until they are FINISHED. */
function waitFor(credentials: InstagramCredentials, containerId: string): Promise<void> {
  return waitForContainer('Instagram', async () => {
    const container = await api.get<{ status_code?: string; status?: string }>(`/${containerId}`, {
      fields: 'status_code,status',
      access_token: credentials.accessToken,
    });
    return { state: container.status_code, detail: container.status };
  });
}

async function createPostContainer(credentials: InstagramCredentials, content: PostContent): Promise<{ id: string; wait: boolean }> {
  const caption = content.text || undefined;
  const [first] = content.media;
  if (!first) throw new ProviderError('Instagram needs an image or video.');

  if (content.media.length === 1) {
    // Single videos are published as reels (plain feed videos are no longer supported).
    if (first.kind === 'video') return { id: await createContainer(credentials, { media_type: 'REELS', video_url: first.url, caption }), wait: true };
    return { id: await createContainer(credentials, { image_url: first.url, caption }), wait: false };
  }

  const children: string[] = [];
  for (const item of content.media) {
    const id = await createContainer(credentials, carouselItem(item));
    if (item.kind === 'video') await waitFor(credentials, id);
    children.push(id);
  }
  return { id: await createContainer(credentials, { media_type: 'CAROUSEL', children: children.join(','), caption }), wait: true };
}

function carouselItem(item: MediaItem): Record<string, string | boolean> {
  return item.kind === 'video'
    ? { is_carousel_item: true, media_type: 'VIDEO', video_url: item.url }
    : { is_carousel_item: true, image_url: item.url };
}

async function publish(credentials: InstagramCredentials, content: PostContent): Promise<PublishResult> {
  const container = await createPostContainer(credentials, content);
  if (container.wait) await waitFor(credentials, container.id);
  const media = await api.post<{ id: string }>(`/${credentials.userId}/media_publish`, {
    creation_id: container.id,
    access_token: credentials.accessToken,
  });
  const permalink = await api
    .get<{ permalink?: string }>(`/${media.id}`, { fields: 'permalink', access_token: credentials.accessToken })
    .then((post) => post.permalink, () => undefined);
  return { remoteId: media.id, url: permalink };
}

export const instagram: Provider<InstagramCredentials> = {
  ...catalog.instagram,
  connector: {
    kind: 'oauth2',
    pkce: false,
    authorizeUrl: (client, { redirectUri, state }) =>
      authorizeUrl(AUTHORIZE_URL, { client_id: client.clientId, redirect_uri: redirectUri, response_type: 'code', state, scope: SCOPE }),
    async exchange(client, { code, redirectUri }) {
      const shortToken = await exchangeCode(client, code, redirectUri);
      const long = await api.get<MetaTokenResponse>(`${GRAPH}/access_token`, {
        grant_type: 'ig_exchange_token',
        client_secret: client.clientSecret,
        access_token: shortToken,
      });
      const me = await api.get<{ id: string; user_id?: string; username: string; name?: string; profile_picture_url?: string }>('/me', {
        fields: 'user_id,username,name,profile_picture_url',
        access_token: long.access_token,
      });
      const userId = String(me.user_id ?? me.id);
      return [
        {
          profile: { externalId: userId, handle: `@${me.username}`, displayName: me.name || undefined, avatarUrl: me.profile_picture_url },
          credentials: { ...tokenFields(long), userId },
        },
      ];
    },
  },
  validate(content) {
    const issues: string[] = [];
    if (content.media.length > MAX_CAROUSEL) issues.push(`Instagram allows at most ${MAX_CAROUSEL} images and videos per post.`);
    // The API only accepts JPEG images; we can only tell when the MIME type is known.
    if (content.media.some((item) => item.kind === 'image' && item.mimeType && item.mimeType !== 'image/jpeg')) {
      issues.push('Instagram only accepts JPEG images.');
    }
    const hashtags = content.text.match(/(^|\s)#[\p{L}\p{N}_]+/gu)?.length ?? 0;
    if (hashtags > MAX_HASHTAGS) issues.push(`Instagram allows at most ${MAX_HASHTAGS} hashtags.`);
    return issues;
  },
  publish: (credentials, content) => publish(credentials, content),
  needsRefresh: (credentials, now) => expiresSoon(credentials, now, REFRESH_MARGIN_MS),
  async refresh(credentials) {
    // Instagram refreshes with the token itself; no client secret involved.
    const response = await api
      .get<MetaTokenResponse>(`${GRAPH}/refresh_access_token`, { grant_type: 'ig_refresh_token', access_token: credentials.accessToken })
      .catch(asReauth('Instagram'));
    return { ...credentials, ...tokenFields(response) };
  },
};
