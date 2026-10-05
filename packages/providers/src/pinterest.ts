import { catalog } from './catalog';
import { bearer, json, requestJson, withQuery } from './http';
import { authorizeUrl, expiresSoon, requireClient, tokenRequest } from './oauth';
import { ProviderError, type ConnectedAccount, type OAuthClient, type OAuthTokens, type PostContent, type Provider } from './types';
import { resolveOptions } from './validate';

const AUTHORIZE_URL = 'https://www.pinterest.com/oauth/';
const TOKEN_URL = 'https://api.pinterest.com/v5/oauth/token';
const API = 'https://api.pinterest.com/v5';
const SCOPE = 'boards:read,pins:read,pins:write,user_accounts:read';

export interface PinterestCredentials extends OAuthTokens {
  boardId: string;
}

interface Board {
  id: string;
  name: string;
}

async function listBoards(token: string): Promise<Board[]> {
  const boards: Board[] = [];
  let bookmark: string | undefined;
  do {
    const page = await requestJson<{ items: Board[]; bookmark?: string | null }>(withQuery(`${API}/boards`, { page_size: 100, bookmark }), {
      headers: bearer(token),
    });
    boards.push(...page.items);
    bookmark = page.bookmark ?? undefined;
  } while (bookmark);
  return boards;
}

async function publish(credentials: PinterestCredentials, content: PostContent) {
  const options = resolveOptions(catalog.pinterest, content.options);
  const image = content.media[0];
  if (!image) throw new ProviderError('Pinterest needs an image.');
  // Pinterest fetches the image itself, so it must be publicly reachable.
  const pin = await requestJson<{ id?: string }>(
    `${API}/pins`,
    json(
      {
        board_id: credentials.boardId,
        ...(options.title && { title: options.title }),
        ...(content.text.trim() && { description: content.text }),
        ...(options.link && { link: options.link }),
        ...(image.altText && { alt_text: image.altText }),
        media_source: { source_type: 'image_url', url: image.url },
      },
      bearer(credentials.accessToken),
    ),
  );
  if (!pin.id) throw new ProviderError('Pinterest did not return the id of the new Pin.');
  return { remoteId: pin.id, url: `https://www.pinterest.com/pin/${pin.id}/` };
}

async function refresh(credentials: PinterestCredentials, client: OAuthClient | undefined): Promise<PinterestCredentials> {
  if (!credentials.refreshToken) throw new ProviderError('Pinterest access expired. Please reconnect the account.', { needsReauth: true });
  const tokens = await tokenRequest(
    TOKEN_URL,
    requireClient(client, 'Pinterest'),
    { grant_type: 'refresh_token', refresh_token: credentials.refreshToken },
    { clientAuth: 'basic' },
  );
  return { ...credentials, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken ?? credentials.refreshToken, expiresAt: tokens.expiresAt };
}

export const pinterest: Provider<PinterestCredentials> = {
  ...catalog.pinterest,
  connector: {
    kind: 'oauth2',
    pkce: false,
    authorizeUrl: (client, { redirectUri, state }) =>
      authorizeUrl(AUTHORIZE_URL, { client_id: client.clientId, redirect_uri: redirectUri, response_type: 'code', state, scope: SCOPE }),
    async exchange(client, { code, redirectUri }) {
      const tokens = await tokenRequest(TOKEN_URL, client, { grant_type: 'authorization_code', code, redirect_uri: redirectUri }, { clientAuth: 'basic' });
      const user = await requestJson<{ username: string; profile_image?: string }>(`${API}/user_account`, { headers: bearer(tokens.accessToken) });
      const boards = await listBoards(tokens.accessToken);
      if (boards.length === 0) throw new ProviderError('Your Pinterest account has no boards yet. Create a board on Pinterest, then connect again.');
      // Each board is its own account so posts can target boards individually.
      return boards.map(
        (board): ConnectedAccount<PinterestCredentials> => ({
          profile: { externalId: board.id, handle: `${user.username} / ${board.name}`, displayName: board.name, avatarUrl: user.profile_image },
          credentials: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt, boardId: board.id },
        }),
      );
    },
  },
  validate(content) {
    const { link } = resolveOptions(catalog.pinterest, content.options);
    if (link && !/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(link)) return ['Destination link must be a full web address starting with https://.'];
    return [];
  },
  publish: (credentials, content) => publish(credentials, content),
  // Access tokens last about 30 days, refresh tokens about a year.
  needsRefresh: (credentials, now) => expiresSoon(credentials, now),
  refresh,
};
