import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { containerPolling } from '../src/meta';
import { threads, type ThreadsCredentials } from '../src/threads';
import type { OAuthConnect } from '../src/types';
import { mockFetch } from './helpers';

const GRAPH = 'https://graph.threads.net/v1.0';
const client = { clientId: 'cid', clientSecret: 'secret' };
const credentials = { accessToken: 'tok', userId: '77', expiresAt: Date.now() + 30 * 86_400_000 };
const content = (text: string, media: { url: string; kind: 'image' | 'video'; altText?: string }[] = []) => ({ text, media, options: {} });
const connector = threads.connector as OAuthConnect<ThreadsCredentials>;
const query = (url: string) => Object.fromEntries(new URL(url).searchParams);
const defaultPolling = { ...containerPolling };

beforeEach(() => Object.assign(containerPolling, { intervalMs: 0, timeoutMs: 1_000 }));
afterEach(() => {
  Object.assign(containerPolling, defaultPolling);
  vi.unstubAllGlobals();
});

/** Routes for a successful publish; container ids count up from c1. */
function publishRoutes(statuses: string[] = []) {
  let container = 0;
  return mockFetch([
    [`POST ${GRAPH}/77/threads_publish`, () => ({ id: 't1' })],
    [`POST ${GRAPH}/77/threads`, () => ({ id: `c${++container}` })],
    [`GET ${GRAPH}/c`, () => ({ status: statuses.shift() ?? 'FINISHED' })],
    [`GET ${GRAPH}/t1`, () => ({ permalink: 'https://www.threads.com/@praxis/post/abc' })],
  ]);
}

describe('threads', () => {
  it('builds the authorize URL', () => {
    const url = new URL(connector.authorizeUrl(client, { redirectUri: 'https://app/cb', state: 's' }));
    expect(url.origin + url.pathname).toBe('https://threads.net/oauth/authorize');
    expect(url.searchParams.get('scope')).toBe('threads_basic,threads_content_publish');
    expect(url.searchParams.get('response_type')).toBe('code');
  });

  it('exchanges the code for a long-lived token and reads the profile', async () => {
    const calls = mockFetch([
      ['POST https://graph.threads.net/oauth/access_token', () => ({ access_token: 'short', user_id: 77 })],
      ['GET https://graph.threads.net/access_token', () => ({ access_token: 'long', token_type: 'bearer', expires_in: 5_184_000 })],
      [`GET ${GRAPH}/me`, () => ({ id: '77', username: 'praxis', name: 'Praxis', threads_profile_picture_url: 'https://pic' })],
    ]);
    const [account] = await connector.exchange(client, { code: 'c', redirectUri: 'https://app/cb' });
    expect(account!.profile).toEqual({ externalId: '77', handle: '@praxis', displayName: 'Praxis', avatarUrl: 'https://pic' });
    expect(account!.credentials).toMatchObject({ accessToken: 'long', userId: '77' });
    expect(calls[0]!.body).toMatchObject({ grant_type: 'authorization_code', code: 'c', client_id: 'cid', client_secret: 'secret' });
    expect(query(calls[1]!.url)).toMatchObject({ grant_type: 'th_exchange_token', client_secret: 'secret', access_token: 'short' });
    expect(query(calls[2]!.url)).toMatchObject({ fields: 'id,username,name,threads_profile_picture_url', access_token: 'long' });
  });

  it('publishes text posts', async () => {
    const calls = publishRoutes();
    const result = await threads.publish(credentials, content('Hello'), { idempotencyKey: 'k' });
    expect(result).toEqual({ remoteId: 't1', url: 'https://www.threads.com/@praxis/post/abc' });
    expect(calls[0]!.body).toEqual({ media_type: 'TEXT', text: 'Hello', access_token: 'tok' });
    expect(calls[1]!.body).toEqual({ creation_id: 'c1', access_token: 'tok' });
  });

  it('publishes a single image with alt text', async () => {
    const calls = publishRoutes();
    await threads.publish(credentials, content('pic', [{ url: 'https://cdn.example/a.jpg', kind: 'image', altText: 'A desk' }]), { idempotencyKey: 'k' });
    expect(calls[0]!.body).toEqual({ media_type: 'IMAGE', image_url: 'https://cdn.example/a.jpg', alt_text: 'A desk', text: 'pic', access_token: 'tok' });
    expect(calls[1]!.url).toBe(`${GRAPH}/77/threads_publish`);
  });

  it('waits for videos to finish processing', async () => {
    const calls = publishRoutes(['IN_PROGRESS', 'IN_PROGRESS', 'FINISHED']);
    await threads.publish(credentials, content('clip', [{ url: 'https://cdn.example/v.mp4', kind: 'video' }]), { idempotencyKey: 'k' });
    expect(calls[0]!.body).toMatchObject({ media_type: 'VIDEO', video_url: 'https://cdn.example/v.mp4' });
    expect(calls.filter((call) => call.url.startsWith(`${GRAPH}/c1?`))).toHaveLength(3);
    expect(query(calls[1]!.url).fields).toBe('status,error_message');
  });

  it('publishes carousels', async () => {
    const calls = publishRoutes();
    const media = [
      { url: 'https://cdn.example/a.jpg', kind: 'image' as const, altText: 'One' },
      { url: 'https://cdn.example/v.mp4', kind: 'video' as const },
    ];
    await threads.publish(credentials, content('set', media), { idempotencyKey: 'k' });
    const creates = calls.filter((call) => call.method === 'POST' && call.url === `${GRAPH}/77/threads`);
    expect(creates.map((call) => call.body)).toEqual([
      { media_type: 'IMAGE', image_url: 'https://cdn.example/a.jpg', alt_text: 'One', is_carousel_item: 'true', access_token: 'tok' },
      { media_type: 'VIDEO', video_url: 'https://cdn.example/v.mp4', is_carousel_item: 'true', access_token: 'tok' },
      { media_type: 'CAROUSEL', children: 'c1,c2', text: 'set', access_token: 'tok' },
    ]);
    expect(calls.find((call) => call.url.endsWith('/threads_publish'))!.body).toMatchObject({ creation_id: 'c3' });
  });

  it('reports processing errors without retrying', async () => {
    mockFetch([
      [`POST ${GRAPH}/77/threads`, () => ({ id: 'c1' })],
      [`GET ${GRAPH}/c1`, () => ({ status: 'ERROR', error_message: 'FAILED_DOWNLOADING_VIDEO' })],
    ]);
    await expect(threads.publish(credentials, content('', [{ url: 'https://cdn.example/v.mp4', kind: 'video' }]), { idempotencyKey: 'k' })).rejects.toMatchObject({
      message: expect.stringContaining('FAILED_DOWNLOADING_VIDEO'),
      retryable: false,
    });
  });

  it('times out slow processing as retryable', async () => {
    Object.assign(containerPolling, { intervalMs: 5, timeoutMs: 20 });
    publishRoutes(Array.from({ length: 100 }, () => 'IN_PROGRESS'));
    await expect(threads.publish(credentials, content('', [{ url: 'https://cdn.example/v.mp4', kind: 'video' }]), { idempotencyKey: 'k' })).rejects.toMatchObject({
      retryable: true,
    });
  });

  it('asks for a reconnect when the token was revoked', async () => {
    mockFetch([[`POST ${GRAPH}/77/threads`, () => new Response(JSON.stringify({ error: { message: 'Invalid OAuth access token', code: 190 } }), { status: 400 })]]);
    await expect(threads.publish(credentials, content('x'), { idempotencyKey: 'k' })).rejects.toMatchObject({ needsReauth: true });
  });

  it('refreshes tokens in their last week', async () => {
    const now = Date.now();
    expect(threads.needsRefresh!(credentials, now)).toBe(false);
    expect(threads.needsRefresh!({ ...credentials, expiresAt: now + 86_400_000 }, now)).toBe(true);

    const calls = mockFetch([['GET https://graph.threads.net/refresh_access_token', () => ({ access_token: 'new', expires_in: 5_184_000 })]]);
    const refreshed = await threads.refresh!(credentials, undefined);
    expect(refreshed).toMatchObject({ accessToken: 'new', userId: '77' });
    expect(query(calls[0]!.url)).toEqual({ grant_type: 'th_refresh_token', access_token: 'tok' });

    mockFetch([['GET https://graph.threads.net/refresh_access_token', () => new Response('{"error":{"message":"expired","code":190}}', { status: 400 })]]);
    await expect(threads.refresh!(credentials, undefined)).rejects.toMatchObject({ needsReauth: true });
  });
});
