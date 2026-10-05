import { afterEach, describe, expect, it, vi } from 'vitest';
import { pinterest, type PinterestCredentials } from '../src/pinterest';
import { ProviderError, type OAuthConnect } from '../src/types';
import { mockFetch } from './helpers';

const client = { clientId: 'cid', clientSecret: 'secret' };
const credentials: PinterestCredentials = { accessToken: 'tok', refreshToken: 'r1', expiresAt: Date.now() + 2_592_000_000, boardId: 'b1' };
const image = { url: 'https://cdn.example/a.png', kind: 'image' as const, altText: 'A pin' };
const content = (options: Record<string, string> = {}, text = 'Nice') => ({ text, media: [image], options });
const connector = pinterest.connector as OAuthConnect<PinterestCredentials>;

afterEach(() => vi.unstubAllGlobals());

describe('pinterest', () => {
  it('builds the authorize URL', () => {
    const url = new URL(connector.authorizeUrl(client, { redirectUri: 'https://app/cb', state: 's' }));
    expect(url.origin + url.pathname).toBe('https://www.pinterest.com/oauth/');
    expect(url.searchParams.get('scope')).toBe('boards:read,pins:read,pins:write,user_accounts:read');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('cid');
  });

  it('connects every board as its own account', async () => {
    const calls = mockFetch([
      ['POST https://api.pinterest.com/v5/oauth/token', () => ({ access_token: 'tok', refresh_token: 'r1', expires_in: 2_592_000 })],
      ['GET https://api.pinterest.com/v5/user_account', () => ({ username: 'praxis', profile_image: 'https://pic' })],
      [
        'GET https://api.pinterest.com/v5/boards',
        (call) =>
          new URL(call.url).searchParams.get('bookmark') === 'next'
            ? { items: [{ id: 'b2', name: 'Exercises' }], bookmark: null }
            : { items: [{ id: 'b1', name: 'Tips' }], bookmark: 'next' },
      ],
    ]);
    const accounts = await connector.exchange(client, { code: 'c', redirectUri: 'https://app/cb' });
    expect(accounts.map((account) => account.profile)).toEqual([
      { externalId: 'b1', handle: 'praxis / Tips', displayName: 'Tips', avatarUrl: 'https://pic' },
      { externalId: 'b2', handle: 'praxis / Exercises', displayName: 'Exercises', avatarUrl: 'https://pic' },
    ]);
    expect(accounts[1]!.credentials).toMatchObject({ accessToken: 'tok', refreshToken: 'r1', boardId: 'b2' });
    expect(calls[0]!.body).toEqual({ grant_type: 'authorization_code', code: 'c', redirect_uri: 'https://app/cb' });
    expect(calls[0]!.headers.authorization).toBe(`Basic ${btoa('cid:secret')}`);
    expect(new URL(calls[2]!.url).searchParams.get('page_size')).toBe('100');
  });

  it('explains that a board is needed', async () => {
    mockFetch([
      ['POST https://api.pinterest.com/v5/oauth/token', () => ({ access_token: 'tok', expires_in: 100 })],
      ['GET https://api.pinterest.com/v5/user_account', () => ({ username: 'praxis' })],
      ['GET https://api.pinterest.com/v5/boards', () => ({ items: [], bookmark: null })],
    ]);
    await expect(connector.exchange(client, { code: 'c', redirectUri: 'x' })).rejects.toThrow(/no boards/);
  });

  it('creates a Pin from the image URL with options', async () => {
    const calls = mockFetch([['POST https://api.pinterest.com/v5/pins', () => Response.json({ id: '555' }, { status: 201 })]]);
    const result = await pinterest.publish(credentials, content({ title: 'Stretch', link: 'https://praxis.example' }), { idempotencyKey: 'k' });
    expect(result).toEqual({ remoteId: '555', url: 'https://www.pinterest.com/pin/555/' });
    expect(calls[0]!.headers.authorization).toBe('Bearer tok');
    expect(calls[0]!.body).toEqual({
      board_id: 'b1',
      title: 'Stretch',
      description: 'Nice',
      link: 'https://praxis.example',
      alt_text: 'A pin',
      media_source: { source_type: 'image_url', url: 'https://cdn.example/a.png' },
    });
  });

  it('leaves out empty options', async () => {
    const calls = mockFetch([['POST https://api.pinterest.com/v5/pins', () => ({ id: '556' })]]);
    await pinterest.publish(credentials, { text: '', media: [{ url: 'https://cdn.example/b.png', kind: 'image' }], options: { title: ' ' } }, { idempotencyKey: 'k' });
    expect(calls[0]!.body).toEqual({ board_id: 'b1', media_source: { source_type: 'image_url', url: 'https://cdn.example/b.png' } });
  });

  it('validates the destination link', () => {
    expect(pinterest.validate!(content({ link: 'https://praxis.example/kurse' }))).toEqual([]);
    expect(pinterest.validate!(content({ link: 'praxis' }))).toHaveLength(1);
  });

  it('maps API errors', async () => {
    mockFetch([['POST https://api.pinterest.com/v5/pins', () => new Response('{"code":2,"message":"Authentication failed."}', { status: 401 })]]);
    await expect(pinterest.publish(credentials, content(), { idempotencyKey: 'k' })).rejects.toMatchObject({ needsReauth: true });

    mockFetch([['POST https://api.pinterest.com/v5/pins', () => new Response('{"code":1,"message":"Invalid board"}', { status: 400 })]]);
    const error = await pinterest.publish(credentials, content(), { idempotencyKey: 'k' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ retryable: false, needsReauth: false });
    expect((error as Error).message).toContain('Invalid board');
  });

  it('refreshes and keeps the refresh token when none is returned', async () => {
    expect(pinterest.needsRefresh!({ ...credentials, expiresAt: Date.now() }, Date.now())).toBe(true);
    expect(pinterest.needsRefresh!(credentials, Date.now())).toBe(false);
    const calls = mockFetch([['POST https://api.pinterest.com/v5/oauth/token', () => ({ access_token: 'tok2', expires_in: 2_592_000 })]]);
    const refreshed = await pinterest.refresh!(credentials, client);
    expect(refreshed).toMatchObject({ accessToken: 'tok2', refreshToken: 'r1', boardId: 'b1' });
    expect(calls[0]!.body).toEqual({ grant_type: 'refresh_token', refresh_token: 'r1' });
    expect(calls[0]!.headers.authorization).toBe(`Basic ${btoa('cid:secret')}`);
  });
});
