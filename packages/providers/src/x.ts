import { catalog } from './catalog';
import { bearer, fetchMedia, json, requestJson } from './http';
import { authorizeUrl, expiresSoon, requireClient, tokenRequest } from './oauth';
import { ProviderError, type MediaItem, type OAuthClient, type OAuthTokens, type PostContent, type Provider, type PublishContext } from './types';

const AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const API = 'https://api.x.com/2';
const SCOPE = 'tweet.read tweet.write users.read media.write offline.access';
/** X rejects images over 5 MB; checking while downloading gives a clearer error. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface XCredentials extends OAuthTokens {
  /** Used to build post URLs. */
  username: string;
}

/**
 * X answers 403 for posts it refuses (duplicate text, missing API access),
 * not only for bad tokens (those get 401), so a 403 must not force a reconnect.
 */
async function xRequest<T>(url: string, init: Parameters<typeof requestJson>[1]): Promise<T> {
  try {
    return await requestJson<T>(url, init);
  } catch (error) {
    if (error instanceof ProviderError && error.status === 403) throw new ProviderError(error.message, { status: 403, cause: error });
    throw error;
  }
}

async function uploadImage(token: string, item: MediaItem, context?: PublishContext): Promise<string> {
  const { blob, mimeType } = await fetchMedia(item, context, MAX_IMAGE_BYTES);
  const body = new FormData();
  body.set('media', blob, 'image');
  body.set('media_category', 'tweet_image');
  if (mimeType.startsWith('image/')) body.set('media_type', mimeType);
  const media = await xRequest<{ data?: { id?: string } }>(`${API}/media/upload`, { method: 'POST', headers: bearer(token), body, timeoutMs: 120_000 });
  if (!media.data?.id) throw new ProviderError('X did not return an id for the uploaded image.', { retryable: true });
  return media.data.id;
}

async function publish(credentials: XCredentials, content: PostContent, context?: PublishContext) {
  const mediaIds = [];
  for (const item of content.media) mediaIds.push(await uploadImage(credentials.accessToken, item, context));

  const post = await xRequest<{ data?: { id?: string } }>(
    `${API}/tweets`,
    json(
      {
        // X accepts an image-only post without text.
        ...(content.text.trim() && { text: content.text }),
        ...(mediaIds.length > 0 && { media: { media_ids: mediaIds } }),
      },
      bearer(credentials.accessToken),
    ),
  );
  const id = post.data?.id;
  if (!id) throw new ProviderError('X did not return the id of the new post.');
  return { remoteId: id, url: `https://x.com/${credentials.username}/status/${id}` };
}

async function refresh(credentials: XCredentials, client: OAuthClient | undefined): Promise<XCredentials> {
  if (!credentials.refreshToken) throw new ProviderError('X access expired. Please reconnect the account.', { needsReauth: true });
  const tokens = await tokenRequest(
    TOKEN_URL,
    requireClient(client, 'X'),
    { grant_type: 'refresh_token', refresh_token: credentials.refreshToken },
    { clientAuth: 'basic' },
  );
  // Refresh tokens rotate: the old one stops working, so the new one must be stored.
  return { ...credentials, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken ?? credentials.refreshToken, expiresAt: tokens.expiresAt };
}

export const x: Provider<XCredentials> = {
  ...catalog.x,
  connector: {
    kind: 'oauth2',
    pkce: true,
    authorizeUrl(client, { redirectUri, state, codeChallenge }) {
      if (!codeChallenge) throw new Error('X requires a PKCE code challenge.');
      return authorizeUrl(AUTHORIZE_URL, {
        response_type: 'code',
        client_id: client.clientId,
        redirect_uri: redirectUri,
        state,
        scope: SCOPE,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });
    },
    async exchange(client, { code, redirectUri, codeVerifier }) {
      if (!codeVerifier) throw new ProviderError('The X sign-in is incomplete. Please try connecting again.');
      const tokens = await tokenRequest(
        TOKEN_URL,
        client,
        { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: codeVerifier },
        { clientAuth: 'basic' },
      );
      const me = await requestJson<{ data: { id: string; username: string; name?: string; profile_image_url?: string } }>(
        `${API}/users/me?user.fields=profile_image_url`,
        { headers: bearer(tokens.accessToken) },
      );
      return [
        {
          profile: { externalId: me.data.id, handle: `@${me.data.username}`, displayName: me.data.name, avatarUrl: me.data.profile_image_url },
          credentials: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt, username: me.data.username },
        },
      ];
    },
  },
  publish: (credentials, content, context) => publish(credentials, content, context),
  // Access tokens last two hours; offline.access always grants a refresh token.
  needsRefresh: (credentials, now) => expiresSoon(credentials, now),
  refresh,
};
