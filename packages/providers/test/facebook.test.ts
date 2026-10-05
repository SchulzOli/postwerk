import { afterEach, describe, expect, it, vi } from 'vitest';
import { facebook, type FacebookCredentials } from '../src/facebook';
import { GRAPH_VERSION } from '../src/meta';
import type { OAuthConnect } from '../src/types';
import { mockFetch } from './helpers';

const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const client = { clientId: 'cid', clientSecret: 'secret' };
const credentials = { accessToken: 'page-tok', pageId: '42' };
const content = (text: string, media: { url: string; kind: 'image' | 'video' }[] = []) => ({ text, media, options: {} });
const connector = facebook.connector as OAuthConnect<FacebookCredentials>;
const query = (url: string) => Object.fromEntries(new URL(url).searchParams);

afterEach(() => vi.unstubAllGlobals());

describe('facebook', () => {
  it('builds the authorize URL with page scopes', () => {
    const url = new URL(connector.authorizeUrl(client, { redirectUri: 'https://app/cb', state: 's' }));
    expect(url.origin + url.pathname).toBe(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
    expect(url.searchParams.get('scope')).toBe('pages_show_list,pages_manage_posts,pages_read_engagement');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('response_type')).toBe('code');
  });

  it('exchanges the code for a long-lived token and returns every page', async () => {
    const calls = mockFetch([
      [
        `GET ${GRAPH}/oauth/access_token`,
        (call) => (query(call.url).grant_type === 'fb_exchange_token' ? { access_token: 'long' } : { access_token: 'short', expires_in: 3600 }),
      ],
      [
        `GET ${GRAPH}/me/accounts?`,
        () => ({
          data: [{ id: '1', name: 'Praxis', username: 'praxis', access_token: 'p1', picture: { data: { url: 'https://pic' } }, tasks: ['CREATE_CONTENT'] }],
          paging: { next: `${GRAPH}/me/accounts/page2` },
        }),
      ],
      [
        `GET ${GRAPH}/me/accounts/page2`,
        () => ({
          data: [
            { id: '2', name: 'Second', access_token: 'p2' },
            { id: '3', name: 'Read only', access_token: 'p3', tasks: ['ANALYZE'] },
          ],
        }),
      ],
    ]);
    const accounts = await connector.exchange(client, { code: 'c', redirectUri: 'https://app/cb' });
    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toEqual({
      profile: { externalId: '1', handle: 'facebook.com/praxis', displayName: 'Praxis', avatarUrl: 'https://pic' },
      credentials: { accessToken: 'p1', pageId: '1' },
    });
    expect(accounts[1]!.profile.handle).toBe('Second');
    expect(query(calls[0]!.url)).toMatchObject({ code: 'c', client_secret: 'secret', redirect_uri: 'https://app/cb' });
    expect(query(calls[1]!.url)).toMatchObject({ grant_type: 'fb_exchange_token', fb_exchange_token: 'short' });
    expect(query(calls[2]!.url)).toMatchObject({ access_token: 'long' });
  });

  it('fails clearly when no page can be posted to', async () => {
    mockFetch([
      [`GET ${GRAPH}/oauth/access_token`, () => ({ access_token: 'tok' })],
      [`GET ${GRAPH}/me/accounts`, () => ({ data: [] })],
    ]);
    await expect(connector.exchange(client, { code: 'c', redirectUri: 'x' })).rejects.toThrow(/No Facebook Pages/);
  });

  it('publishes text posts to the page feed', async () => {
    const calls = mockFetch([
      [`POST ${GRAPH}/42/feed`, () => ({ id: '42_7' })],
      [`GET ${GRAPH}/42_7`, () => ({ permalink_url: 'https://www.facebook.com/praxis/posts/7' })],
    ]);
    const result = await facebook.publish(credentials, content('Hello'), { idempotencyKey: 'k' });
    expect(result).toEqual({ remoteId: '42_7', url: 'https://www.facebook.com/praxis/posts/7' });
    expect(calls[0]!.body).toEqual({ message: 'Hello', access_token: 'page-tok' });
  });

  it('publishes a single photo with a caption', async () => {
    const calls = mockFetch([
      [`POST ${GRAPH}/42/photos`, () => ({ id: '9', post_id: '42_9' })],
      [`GET ${GRAPH}/42_9`, () => new Response('{}', { status: 500 })],
    ]);
    const result = await facebook.publish(credentials, content('pic', [{ url: 'https://cdn.example/a.jpg', kind: 'image' }]), { idempotencyKey: 'k' });
    // The permalink lookup is best effort.
    expect(result).toEqual({ remoteId: '42_9', url: 'https://www.facebook.com/42_9' });
    expect(calls[0]!.body).toEqual({ url: 'https://cdn.example/a.jpg', caption: 'pic', access_token: 'page-tok' });
  });

  it('attaches several unpublished photos to one feed post', async () => {
    let photo = 0;
    const calls = mockFetch([
      [`POST ${GRAPH}/42/photos`, () => ({ id: `p${++photo}` })],
      [`POST ${GRAPH}/42/feed`, () => ({ id: '42_8' })],
      [`GET ${GRAPH}/42_8`, () => ({})],
    ]);
    const media = [
      { url: 'https://cdn.example/a.jpg', kind: 'image' as const },
      { url: 'https://cdn.example/b.jpg', kind: 'image' as const },
    ];
    const result = await facebook.publish(credentials, content('two', media), { idempotencyKey: 'k' });
    expect(result.remoteId).toBe('42_8');
    expect(calls[0]!.body).toMatchObject({ url: 'https://cdn.example/a.jpg', published: 'false' });
    expect(calls[2]!.body).toMatchObject({ message: 'two', attached_media: '[{"media_fbid":"p1"},{"media_fbid":"p2"}]' });
  });

  it('publishes videos from a URL', async () => {
    const calls = mockFetch([[`POST ${GRAPH}/42/videos`, () => ({ id: 'v1' })]]);
    const result = await facebook.publish(credentials, content('clip', [{ url: 'https://cdn.example/v.mp4', kind: 'video' }]), { idempotencyKey: 'k' });
    expect(result).toEqual({ remoteId: 'v1', url: 'https://www.facebook.com/42/videos/v1' });
    expect(calls[0]!.body).toEqual({ file_url: 'https://cdn.example/v.mp4', description: 'clip', access_token: 'page-tok' });
  });

  it('maps Graph error codes', async () => {
    const graphError = (code: number, status = 400) => () =>
      new Response(JSON.stringify({ error: { message: 'Error validating access token', type: 'OAuthException', code } }), { status });

    mockFetch([[`POST ${GRAPH}/42/feed`, graphError(190)]]);
    await expect(facebook.publish(credentials, content('x'), { idempotencyKey: 'k' })).rejects.toMatchObject({ needsReauth: true, retryable: false });

    // Rate limits sometimes come back as 403, which must not look like a revoked token.
    mockFetch([[`POST ${GRAPH}/42/feed`, graphError(32, 403)]]);
    await expect(facebook.publish(credentials, content('x'), { idempotencyKey: 'k' })).rejects.toMatchObject({ needsReauth: false, retryable: true });

    mockFetch([[`POST ${GRAPH}/42/feed`, graphError(100)]]);
    await expect(facebook.publish(credentials, content('x'), { idempotencyKey: 'k' })).rejects.toMatchObject({ needsReauth: false, retryable: false });

    mockFetch([[`POST ${GRAPH}/42/feed`, () => new Response('<html>Bad gateway</html>', { status: 502 })]]);
    await expect(facebook.publish(credentials, content('x'), { idempotencyKey: 'k' })).rejects.toMatchObject({ retryable: true });
  });

  it('does not need token refreshes', () => {
    expect(facebook.refresh).toBeUndefined();
    expect(facebook.needsRefresh).toBeUndefined();
  });
});
