import { afterEach, describe, expect, it, vi } from 'vitest';
import { x, type XCredentials } from '../src/x';
import { ProviderError, type OAuthConnect } from '../src/types';
import { imageResponse, mockFetch } from './helpers';

const client = { clientId: 'cid', clientSecret: 'secret' };
const credentials: XCredentials = { accessToken: 'tok', refreshToken: 'r1', expiresAt: Date.now() + 7_200_000, username: 'oli' };
const content = (text: string, media: { url: string; kind: 'image' }[] = []) => ({ text, media, options: {} });
const connector = x.connector as OAuthConnect<XCredentials>;

afterEach(() => vi.unstubAllGlobals());

describe('x', () => {
  it('builds the authorize URL with a PKCE challenge', () => {
    expect(connector.pkce).toBe(true);
    const url = new URL(connector.authorizeUrl(client, { redirectUri: 'https://app/cb', state: 's', codeChallenge: 'chal' }));
    expect(url.origin + url.pathname).toBe('https://x.com/i/oauth2/authorize');
    expect(url.searchParams.get('scope')).toBe('tweet.read tweet.write users.read media.write offline.access');
    expect(url.searchParams.get('code_challenge')).toBe('chal');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('client_id')).toBe('cid');
  });

  it('exchanges the code with the verifier and reads the profile', async () => {
    const calls = mockFetch([
      ['POST https://api.x.com/2/oauth2/token', () => ({ access_token: 'tok', refresh_token: 'r1', expires_in: 7200 })],
      ['GET https://api.x.com/2/users/me', () => ({ data: { id: '42', username: 'oli', name: 'Oli S', profile_image_url: 'https://pic' } })],
    ]);
    const accounts = await connector.exchange(client, { code: 'c', redirectUri: 'https://app/cb', codeVerifier: 'ver' });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.profile).toEqual({ externalId: '42', handle: '@oli', displayName: 'Oli S', avatarUrl: 'https://pic' });
    expect(accounts[0]!.credentials).toMatchObject({ accessToken: 'tok', refreshToken: 'r1', username: 'oli' });
    expect(calls[0]!.body).toEqual({ grant_type: 'authorization_code', code: 'c', redirect_uri: 'https://app/cb', code_verifier: 'ver' });
    expect(calls[0]!.headers.authorization).toBe(`Basic ${btoa('cid:secret')}`);
    expect(calls[1]!.url).toContain('user.fields=profile_image_url');
  });

  it('publishes text posts', async () => {
    const calls = mockFetch([['POST https://api.x.com/2/tweets', () => Response.json({ data: { id: '99', text: 'Hello' } }, { status: 201 })]]);
    const result = await x.publish(credentials, content('Hello'), { idempotencyKey: 'k' });
    expect(result).toEqual({ remoteId: '99', url: 'https://x.com/oli/status/99' });
    expect(calls[0]!.headers.authorization).toBe('Bearer tok');
    expect(calls[0]!.body).toEqual({ text: 'Hello' });
  });

  it('uploads images first', async () => {
    const calls = mockFetch([
      ['GET https://cdn.example/', () => imageResponse()],
      ['POST https://api.x.com/2/media/upload', () => ({ data: { id: '7', media_key: '3_7' } })],
      ['POST https://api.x.com/2/tweets', () => ({ data: { id: '100' } })],
    ]);
    const media = [
      { url: 'https://cdn.example/a.png', kind: 'image' as const },
      { url: 'https://cdn.example/b.png', kind: 'image' as const },
    ];
    await x.publish(credentials, content('', media), { idempotencyKey: 'k' });
    const upload = calls.find((call) => call.url.includes('/media/upload'))!;
    expect(upload.body).toMatchObject({ media: '<file 4>', media_category: 'tweet_image', media_type: 'image/png' });
    expect(calls.at(-1)!.body).toEqual({ media: { media_ids: ['7', '7'] } });
  });

  it('maps errors: 401 needs a reconnect, 403 is a refused post', async () => {
    mockFetch([['POST https://api.x.com/2/tweets', () => new Response('{"title":"Unauthorized","detail":"Unauthorized"}', { status: 401 })]]);
    await expect(x.publish(credentials, content('x'), { idempotencyKey: 'k' })).rejects.toMatchObject({ needsReauth: true });

    mockFetch([
      [
        'POST https://api.x.com/2/tweets',
        () => new Response('{"title":"Forbidden","detail":"You are not allowed to create a Tweet with duplicate content."}', { status: 403 }),
      ],
    ]);
    const error = await x.publish(credentials, content('x'), { idempotencyKey: 'k' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ needsReauth: false, retryable: false });
    expect((error as Error).message).toContain('duplicate content');
  });

  it('refreshes and stores the rotated refresh token', async () => {
    expect(x.needsRefresh!({ ...credentials, expiresAt: Date.now() + 60_000 }, Date.now())).toBe(true);
    expect(x.needsRefresh!(credentials, Date.now())).toBe(false);
    const calls = mockFetch([['POST https://api.x.com/2/oauth2/token', () => ({ access_token: 'tok2', refresh_token: 'r2', expires_in: 7200 })]]);
    const refreshed = await x.refresh!(credentials, client);
    expect(refreshed).toMatchObject({ accessToken: 'tok2', refreshToken: 'r2', username: 'oli' });
    expect(refreshed.expiresAt).toBeGreaterThan(Date.now());
    expect(calls[0]!.body).toEqual({ grant_type: 'refresh_token', refresh_token: 'r1' });
    expect(calls[0]!.headers.authorization).toBe(`Basic ${btoa('cid:secret')}`);
  });

  it('asks for a reconnect when the refresh token is revoked', async () => {
    mockFetch([['POST https://api.x.com/2/oauth2/token', () => new Response('{"error":"invalid_request"}', { status: 400 })]]);
    await expect(x.refresh!(credentials, client)).rejects.toMatchObject({ needsReauth: true });
    await expect(x.refresh!({ ...credentials, refreshToken: undefined }, client)).rejects.toMatchObject({ needsReauth: true });
  });
});
