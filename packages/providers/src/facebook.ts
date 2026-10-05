import { catalog } from './catalog';
import { GRAPH_VERSION, graphApi, type MetaTokenResponse } from './meta';
import { authorizeUrl } from './oauth';
import { ProviderError, type ConnectedAccount, type OAuthTokens, type PostContent, type Provider, type PublishResult } from './types';

const AUTHORIZE_URL = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;
const SCOPE = 'pages_show_list,pages_manage_posts,pages_read_engagement';
const api = graphApi('Facebook', `https://graph.facebook.com/${GRAPH_VERSION}`);

/** `accessToken` is the Page access token, which does not expire when derived from a long-lived user token. */
export interface FacebookCredentials extends OAuthTokens {
  pageId: string;
}

interface Page {
  id: string;
  name: string;
  username?: string;
  access_token?: string;
  picture?: { data?: { url?: string } };
  tasks?: string[];
}

interface PageList {
  data: Page[];
  paging?: { next?: string };
}

async function listPages(userToken: string): Promise<ConnectedAccount<FacebookCredentials>[]> {
  const pages: Page[] = [];
  let list = await api.get<PageList>('/me/accounts', {
    fields: 'id,name,username,access_token,picture{url},tasks',
    limit: 100,
    access_token: userToken,
  });
  pages.push(...list.data);
  // Paging links already carry the token and fields; stop at a sane number of pages.
  for (let i = 0; list.paging?.next && i < 10; i++) {
    list = await api.get<PageList>(list.paging.next);
    pages.push(...list.data);
  }

  // Pages where the user cannot create content (e.g. analyst role) would fail at publish time.
  const usable = pages.filter((page) => page.access_token && (!page.tasks || page.tasks.includes('CREATE_CONTENT')));
  if (usable.length === 0) {
    throw new ProviderError('No Facebook Pages found that you can post to. Make sure you selected your Pages when connecting.');
  }
  return usable.map((page) => ({
    profile: {
      externalId: page.id,
      handle: page.username ? `facebook.com/${page.username}` : page.name,
      displayName: page.name,
      avatarUrl: page.picture?.data?.url,
    },
    credentials: { accessToken: page.access_token!, pageId: page.id },
  }));
}

async function publish({ accessToken, pageId }: FacebookCredentials, content: PostContent): Promise<PublishResult> {
  const text = content.text || undefined;
  const [first] = content.media;

  // Videos cannot be combined with other media (see catalog), so a video is always alone.
  if (first?.kind === 'video') {
    const video = await api.post<{ id: string }>(`/${pageId}/videos`, { file_url: first.url, description: text, access_token: accessToken });
    return { remoteId: video.id, url: `https://www.facebook.com/${pageId}/videos/${video.id}` };
  }

  let postId: string;
  if (content.media.length === 1 && first) {
    const photo = await api.post<{ id: string; post_id?: string }>(`/${pageId}/photos`, { url: first.url, caption: text, access_token: accessToken });
    postId = photo.post_id ?? photo.id;
  } else {
    // Several photos: upload them unpublished, then attach them to one feed post.
    const mediaIds: string[] = [];
    for (const item of content.media) {
      const photo = await api.post<{ id: string }>(`/${pageId}/photos`, { url: item.url, published: false, access_token: accessToken });
      mediaIds.push(photo.id);
    }
    const post = await api.post<{ id: string }>(`/${pageId}/feed`, {
      message: text,
      attached_media: mediaIds.length > 0 ? JSON.stringify(mediaIds.map((id) => ({ media_fbid: id }))) : undefined,
      access_token: accessToken,
    });
    postId = post.id;
  }

  // The permalink is nicer but optional; the post id URL works as well.
  const permalink = await api
    .get<{ permalink_url?: string }>(`/${postId}`, { fields: 'permalink_url', access_token: accessToken })
    .then((post) => post.permalink_url, () => undefined);
  return { remoteId: postId, url: permalink ?? `https://www.facebook.com/${postId}` };
}

export const facebook: Provider<FacebookCredentials> = {
  ...catalog.facebook,
  connector: {
    kind: 'oauth2',
    pkce: false,
    authorizeUrl: (client, { redirectUri, state }) =>
      authorizeUrl(AUTHORIZE_URL, { client_id: client.clientId, redirect_uri: redirectUri, state, response_type: 'code', scope: SCOPE }),
    async exchange(client, { code, redirectUri }) {
      const short = await api.get<MetaTokenResponse>('/oauth/access_token', {
        client_id: client.clientId,
        client_secret: client.clientSecret,
        redirect_uri: redirectUri,
        code,
      });
      // Page tokens obtained with a long-lived user token never expire, so no refresh is needed later.
      const long = await api.get<MetaTokenResponse>('/oauth/access_token', {
        grant_type: 'fb_exchange_token',
        client_id: client.clientId,
        client_secret: client.clientSecret,
        fb_exchange_token: short.access_token,
      });
      return listPages(long.access_token);
    },
  },
  publish: (credentials, content) => publish(credentials, content),
};
