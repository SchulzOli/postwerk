import { afterEach, describe, expect, it, vi } from 'vitest';
import { escapeCommentary, linkedin, linkedinPage, linkedInVersion } from '../src/linkedin';
import { ProviderError, type OAuthConnect } from '../src/types';
import { imageResponse, mockFetch } from './helpers';

const client = { clientId: 'cid', clientSecret: 'secret' };
const credentials = { accessToken: 'tok', author: 'urn:li:person:abc' };
const content = (text: string, media: { url: string; kind: 'image' }[] = []) => ({ text, media, options: {} });

afterEach(() => vi.unstubAllGlobals());

describe('linkedin', () => {
  it('uses a recent API version', () => {
    expect(linkedInVersion(new Date('2026-10-05'))).toBe('202608');
    expect(linkedInVersion(new Date('2026-01-15'))).toBe('202511');
  });

  it('escapes little-text markup', () => {
    expect(escapeCommentary('Hi (all) @team #tag *bold*')).toBe('Hi \\(all\\) \\@team #tag \\*bold\\*');
  });

  it('builds the authorize URL with personal scopes', () => {
    const connector = linkedin.connector as OAuthConnect<unknown>;
    const url = new URL(connector.authorizeUrl(client, { redirectUri: 'https://app/cb', state: 's' }));
    expect(url.searchParams.get('scope')).toBe('openid profile w_member_social');
    expect(url.searchParams.get('client_id')).toBe('cid');
  });

  it('exchanges the code and reads the member profile', async () => {
    const calls = mockFetch([
      ['POST https://www.linkedin.com/oauth/v2/accessToken', () => ({ access_token: 'tok', expires_in: 5_184_000 })],
      ['GET https://api.linkedin.com/v2/userinfo', () => ({ sub: 'abc', name: 'Oli S', picture: 'https://pic' })],
    ]);
    const [account] = await (linkedin.connector as OAuthConnect<typeof credentials>).exchange(client, { code: 'c', redirectUri: 'https://app/cb' });
    expect(account!.profile).toMatchObject({ externalId: 'abc', displayName: 'Oli S' });
    expect(account!.credentials).toMatchObject({ accessToken: 'tok', author: 'urn:li:person:abc' });
    expect(calls[0]!.body).toMatchObject({ grant_type: 'authorization_code', code: 'c', client_secret: 'secret' });
  });

  it('lists administered pages', async () => {
    mockFetch([
      ['POST https://www.linkedin.com/oauth/v2/accessToken', () => ({ access_token: 'tok', expires_in: 100 })],
      ['GET https://api.linkedin.com/rest/organizationAcls', () => ({ elements: [{ organization: 'urn:li:organization:42' }] })],
      ['GET https://api.linkedin.com/rest/organizations/42', () => ({ localizedName: 'Praxis', vanityName: 'praxis' })],
    ]);
    const accounts = await (linkedinPage.connector as OAuthConnect<typeof credentials>).exchange(client, { code: 'c', redirectUri: 'x' });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.credentials.author).toBe('urn:li:organization:42');
    expect(accounts[0]!.profile.displayName).toBe('Praxis');
  });

  it('publishes text posts', async () => {
    const calls = mockFetch([
      ['POST https://api.linkedin.com/rest/posts', () => new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:1' } })],
    ]);
    const result = await linkedin.publish(credentials, content('Hello (world)'), { idempotencyKey: 'k' });
    expect(result).toEqual({ remoteId: 'urn:li:share:1', url: 'https://www.linkedin.com/feed/update/urn:li:share:1' });
    expect(calls[0]!.headers).toMatchObject({ authorization: 'Bearer tok', 'x-restli-protocol-version': '2.0.0' });
    expect(calls[0]!.body).toMatchObject({ author: 'urn:li:person:abc', commentary: 'Hello \\(world\\)', lifecycleState: 'PUBLISHED' });
  });

  it('uploads images first', async () => {
    const calls = mockFetch([
      ['GET https://cdn.example/', () => imageResponse()],
      ['POST https://api.linkedin.com/rest/images', () => ({ value: { uploadUrl: 'https://upload.example/u', image: 'urn:li:image:9' } })],
      ['PUT https://upload.example/u', () => new Response(null, { status: 201 })],
      ['POST https://api.linkedin.com/rest/posts', () => new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:2' } })],
    ]);
    await linkedin.publish(credentials, content('pic', [{ url: 'https://cdn.example/a.png', kind: 'image' }]), { idempotencyKey: 'k' });
    expect(calls.at(-1)!.body).toMatchObject({ content: { media: { id: 'urn:li:image:9' } } });
  });

  it('asks for a reconnect when the token is expired and cannot be refreshed', async () => {
    expect(linkedin.needsRefresh!({ ...credentials, expiresAt: 0 }, Date.now())).toBe(false);
    await expect(linkedin.refresh!(credentials, client)).rejects.toMatchObject({ needsReauth: true });
    mockFetch([['POST https://api.linkedin.com/rest/posts', () => new Response('{"message":"expired"}', { status: 401 })]]);
    await expect(linkedin.publish(credentials, content('x'), { idempotencyKey: 'k' })).rejects.toBeInstanceOf(ProviderError);
  });
});
