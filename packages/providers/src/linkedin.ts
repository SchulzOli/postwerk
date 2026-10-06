import { catalog } from './catalog';
import { bearer, fetchMedia, json, request, requestJson, withQuery } from './http';
import { authorizeUrl, expiresSoon, requireClient, tokenRequest } from './oauth';
import { ProviderError, type ConnectedAccount, type MediaItem, type OAuthTokens, type Provider, type ProviderInfo, type PublishContext } from './types';

const AUTHORIZE_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const API = 'https://api.linkedin.com';

export interface LinkedInCredentials extends OAuthTokens {
  /** urn:li:person:… or urn:li:organization:… */
  author: string;
}

/**
 * LinkedIn's versioned API requires a YYYYMM version header and retires
 * versions after about a year, so we always ask for the one from two months ago.
 */
export function linkedInVersion(now = new Date()): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function apiHeaders(token: string): Record<string, string> {
  return { ...bearer(token), 'linkedin-version': linkedInVersion(), 'x-restli-protocol-version': '2.0.0' };
}

/** Post commentary uses "little text" markup; these characters must be escaped to appear literally. */
export function escapeCommentary(text: string): string {
  return text.replace(/[\\|{}@[\]()<>*_~]/g, (char) => `\\${char}`);
}

async function uploadImage(token: string, owner: string, item: MediaItem, context?: PublishContext): Promise<{ id: string; altText?: string }> {
  const init = await requestJson<{ value: { uploadUrl: string; image: string } }>(
    `${API}/rest/images?action=initializeUpload`,
    json({ initializeUploadRequest: { owner } }, apiHeaders(token)),
  );
  const { blob } = await fetchMedia(item, context);
  await request(init.value.uploadUrl, { method: 'PUT', headers: bearer(token), body: blob, timeoutMs: 120_000 });
  return { id: init.value.image, altText: item.altText };
}

async function publish(credentials: LinkedInCredentials, content: { text: string; media: MediaItem[] }, context?: PublishContext) {
  const images = [];
  for (const item of content.media) images.push(await uploadImage(credentials.accessToken, credentials.author, item, context));
  const media =
    images.length === 1
      ? { media: { id: images[0]!.id, ...(images[0]!.altText && { altText: images[0]!.altText }) } }
      : images.length > 1
        ? { multiImage: { images: images.map((image) => ({ id: image.id, ...(image.altText && { altText: image.altText }) })) } }
        : undefined;

  const response = await request(
    `${API}/rest/posts`,
    json(
      {
        author: credentials.author,
        commentary: escapeCommentary(content.text),
        visibility: 'PUBLIC',
        distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
        ...(media && { content: media }),
      },
      apiHeaders(credentials.accessToken),
    ),
  );
  const urn = response.headers.get('x-restli-id');
  if (!urn) throw new ProviderError('LinkedIn did not return the id of the new post.');
  return { remoteId: urn, url: `https://www.linkedin.com/feed/update/${urn}` };
}

async function refresh(credentials: LinkedInCredentials, client: Parameters<NonNullable<Provider['refresh']>>[1]): Promise<LinkedInCredentials> {
  if (!credentials.refreshToken) throw new ProviderError('LinkedIn access expired. Please reconnect the account.', { needsReauth: true });
  const tokens = await tokenRequest(TOKEN_URL, requireClient(client, 'LinkedIn'), {
    grant_type: 'refresh_token',
    refresh_token: credentials.refreshToken,
  });
  return { ...credentials, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken ?? credentials.refreshToken, expiresAt: tokens.expiresAt };
}

function createProvider(
  info: ProviderInfo,
  scope: string,
  listAccounts: (tokens: OAuthTokens) => Promise<ConnectedAccount<LinkedInCredentials>[]>,
): Provider<LinkedInCredentials> {
  return {
    ...info,
    connector: {
      kind: 'oauth2',
      pkce: false,
      authorizeUrl: (client, { redirectUri, state }) =>
        authorizeUrl(AUTHORIZE_URL, { response_type: 'code', client_id: client.clientId, redirect_uri: redirectUri, state, scope }),
      async exchange(client, { code, redirectUri }) {
        const tokens = await tokenRequest(TOKEN_URL, client, { grant_type: 'authorization_code', code, redirect_uri: redirectUri });
        return listAccounts(tokens);
      },
    },
    publish: (credentials, content, context) => publish(credentials, content, context),
    // Refresh tokens are only issued to approved partners; without one the user reconnects after ~60 days.
    needsRefresh: (credentials, now) => Boolean(credentials.refreshToken) && expiresSoon(credentials, now),
    refresh,
  };
}

const tokenFields = (tokens: OAuthTokens) => ({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt });

export const linkedin = createProvider(catalog.linkedin, 'openid profile w_member_social', async (tokens) => {
  const me = await requestJson<{ sub: string; name?: string; picture?: string }>(`${API}/v2/userinfo`, { headers: bearer(tokens.accessToken) });
  return [
    {
      profile: { externalId: me.sub, handle: me.name ?? 'LinkedIn member', displayName: me.name, avatarUrl: me.picture },
      credentials: { ...tokenFields(tokens), author: `urn:li:person:${me.sub}` },
    },
  ];
});

interface OrganizationAcl {
  organization: string;
}

export const linkedinPage = createProvider(catalog.linkedin_page, 'r_organization_admin w_organization_social', async (tokens) => {
  const acls = await requestJson<{ elements: OrganizationAcl[] }>(
    withQuery(`${API}/rest/organizationAcls`, { q: 'roleAssignee', role: 'ADMINISTRATOR', state: 'APPROVED' }),
    { headers: apiHeaders(tokens.accessToken) },
  );
  const accounts: ConnectedAccount<LinkedInCredentials>[] = [];
  for (const { organization } of acls.elements) {
    const id = organization.split(':').pop()!;
    const org = await requestJson<{ localizedName?: string; vanityName?: string }>(`${API}/rest/organizations/${id}`, {
      headers: apiHeaders(tokens.accessToken),
    });
    accounts.push({
      profile: { externalId: organization, handle: org.vanityName ? `linkedin.com/company/${org.vanityName}` : organization, displayName: org.localizedName },
      credentials: { ...tokenFields(tokens), author: organization },
    });
  }
  if (accounts.length === 0) throw new ProviderError('No LinkedIn pages found where you are an administrator.');
  return accounts;
});
