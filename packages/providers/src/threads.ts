import { catalog } from './catalog';
import { form } from './http';
import { asReauth, graphApi, graphRequest, LONG_LIVED_SECONDS, waitForContainer, type MetaTokenResponse } from './meta';
import { authorizeUrl, expiresSoon } from './oauth';
import { ProviderError, type MediaItem, type OAuthTokens, type PostContent, type Provider, type PublishResult } from './types';

const AUTHORIZE_URL = 'https://threads.net/oauth/authorize';
const GRAPH = 'https://graph.threads.net';
const SCOPE = 'threads_basic,threads_content_publish';
// Threads versions its API separately from the Facebook Graph API.
const api = graphApi('Threads', `${GRAPH}/v1.0`);

/** Long-lived tokens last 60 days and can be extended once they are a day old; renew in the last week. */
const REFRESH_MARGIN_MS = 7 * 24 * 60 * 60_000;

export interface ThreadsCredentials extends OAuthTokens {
  userId: string;
}

function tokenFields(response: MetaTokenResponse, now = Date.now()): OAuthTokens {
  return { accessToken: response.access_token, expiresAt: now + (response.expires_in ?? LONG_LIVED_SECONDS) * 1000 };
}

function createContainer(credentials: ThreadsCredentials, params: Record<string, string | boolean | undefined>): Promise<string> {
  return api
    .post<{ id: string }>(`/${credentials.userId}/threads`, { ...params, access_token: credentials.accessToken })
    .then((container) => container.id);
}

/** Video and carousel containers are processed asynchronously and cannot be published until FINISHED. */
function waitFor(credentials: ThreadsCredentials, containerId: string): Promise<void> {
  return waitForContainer('Threads', async () => {
    const container = await api.get<{ status?: string; error_message?: string }>(`/${containerId}`, {
      fields: 'status,error_message',
      access_token: credentials.accessToken,
    });
    return { state: container.status, detail: container.error_message };
  });
}

const mediaParams = (item: MediaItem) =>
  item.kind === 'video'
    ? { media_type: 'VIDEO', video_url: item.url, alt_text: item.altText }
    : { media_type: 'IMAGE', image_url: item.url, alt_text: item.altText };

async function createPostContainer(credentials: ThreadsCredentials, content: PostContent): Promise<{ id: string; wait: boolean }> {
  const text = content.text || undefined;
  const [first] = content.media;
  if (!first) return { id: await createContainer(credentials, { media_type: 'TEXT', text }), wait: false };
  if (content.media.length === 1) return { id: await createContainer(credentials, { ...mediaParams(first), text }), wait: first.kind === 'video' };

  const children: string[] = [];
  for (const item of content.media) {
    const id = await createContainer(credentials, { ...mediaParams(item), is_carousel_item: true });
    if (item.kind === 'video') await waitFor(credentials, id);
    children.push(id);
  }
  return { id: await createContainer(credentials, { media_type: 'CAROUSEL', children: children.join(','), text }), wait: true };
}

async function publish(credentials: ThreadsCredentials, content: PostContent): Promise<PublishResult> {
  const container = await createPostContainer(credentials, content);
  if (container.wait) await waitFor(credentials, container.id);
  const post = await api.post<{ id: string }>(`/${credentials.userId}/threads_publish`, {
    creation_id: container.id,
    access_token: credentials.accessToken,
  });
  const permalink = await api
    .get<{ permalink?: string }>(`/${post.id}`, { fields: 'permalink', access_token: credentials.accessToken })
    .then((thread) => thread.permalink, () => undefined);
  return { remoteId: post.id, url: permalink };
}

export const threads: Provider<ThreadsCredentials> = {
  ...catalog.threads,
  connector: {
    kind: 'oauth2',
    pkce: false,
    authorizeUrl: (client, { redirectUri, state }) =>
      authorizeUrl(AUTHORIZE_URL, { client_id: client.clientId, redirect_uri: redirectUri, scope: SCOPE, response_type: 'code', state }),
    async exchange(client, { code, redirectUri }) {
      const short = await graphRequest<MetaTokenResponse>(
        'Threads',
        `${GRAPH}/oauth/access_token`,
        form({ client_id: client.clientId, client_secret: client.clientSecret, grant_type: 'authorization_code', redirect_uri: redirectUri, code }),
      );
      if (!short.access_token) throw new ProviderError('Threads did not return an access token.', { needsReauth: true });
      const long = await api.get<MetaTokenResponse>(`${GRAPH}/access_token`, {
        grant_type: 'th_exchange_token',
        client_secret: client.clientSecret,
        access_token: short.access_token,
      });
      const me = await api.get<{ id: string; username: string; name?: string; threads_profile_picture_url?: string }>('/me', {
        fields: 'id,username,name,threads_profile_picture_url',
        access_token: long.access_token,
      });
      return [
        {
          profile: { externalId: me.id, handle: `@${me.username}`, displayName: me.name || undefined, avatarUrl: me.threads_profile_picture_url },
          credentials: { ...tokenFields(long), userId: me.id },
        },
      ];
    },
  },
  publish: (credentials, content) => publish(credentials, content),
  needsRefresh: (credentials, now) => expiresSoon(credentials, now, REFRESH_MARGIN_MS),
  async refresh(credentials) {
    // Threads refreshes with the token itself; no client secret involved.
    const response = await api
      .get<MetaTokenResponse>(`${GRAPH}/refresh_access_token`, { grant_type: 'th_refresh_token', access_token: credentials.accessToken })
      .catch(asReauth('Threads'));
    return { ...credentials, ...tokenFields(response) };
  },
};
