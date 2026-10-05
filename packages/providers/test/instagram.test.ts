import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { instagram, type InstagramCredentials } from '../src/instagram';
import { containerPolling, GRAPH_VERSION } from '../src/meta';
import type { OAuthConnect } from '../src/types';
import { mockFetch } from './helpers';

const GRAPH = `https://graph.instagram.com/${GRAPH_VERSION}`;
const client = { clientId: 'cid', clientSecret: 'secret' };
const credentials = { accessToken: 'tok', userId: '1784', expiresAt: Date.now() + 30 * 86_400_000 };
const image = (name: string) => ({ url: `https://cdn.example/${name}.jpg`, kind: 'image' as const });
const video = (name: string) => ({ url: `https://cdn.example/${name}.mp4`, kind: 'video' as const });
const content = (text: string, media: { url: string; kind: 'image' | 'video'; mimeType?: string }[] = []) => ({ text, media, options: {} });
const connector = instagram.connector as OAuthConnect<InstagramCredentials>;
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
    [`POST ${GRAPH}/1784/media_publish`, () => ({ id: 'm1' })],
    [`POST ${GRAPH}/1784/media`, () => ({ id: `c${++container}` })],
    [`GET ${GRAPH}/c`, () => ({ status_code: statuses.shift() ?? 'FINISHED' })],
    [`GET ${GRAPH}/m1`, () => ({ permalink: 'https://www.instagram.com/p/abc/' })],
  ]);
}

describe('instagram', () => {
  it('builds the authorize URL with business scopes', () => {
    const url = new URL(connector.authorizeUrl(client, { redirectUri: 'https://app/cb', state: 's' }));
    expect(url.origin + url.pathname).toBe('https://www.instagram.com/oauth/authorize');
    expect(url.searchParams.get('scope')).toBe('instagram_business_basic,instagram_business_content_publish');
    expect(url.searchParams.get('state')).toBe('s');
  });

  it('exchanges the code for a long-lived token and reads the profile', async () => {
    const calls = mockFetch([
      ['POST https://api.instagram.com/oauth/access_token', () => ({ data: [{ access_token: 'short', user_id: '99', permissions: 'x' }] })],
      ['GET https://graph.instagram.com/access_token', () => ({ access_token: 'long', token_type: 'bearer', expires_in: 5_184_000 })],
      [`GET ${GRAPH}/me`, () => ({ id: '99', user_id: '1784', username: 'praxis', name: 'Praxis', profile_picture_url: 'https://pic' })],
    ]);
    const before = Date.now();
    const [account] = await connector.exchange(client, { code: 'c', redirectUri: 'https://app/cb' });
    expect(account!.profile).toEqual({ externalId: '1784', handle: '@praxis', displayName: 'Praxis', avatarUrl: 'https://pic' });
    expect(account!.credentials).toMatchObject({ accessToken: 'long', userId: '1784' });
    expect(account!.credentials.expiresAt).toBeGreaterThanOrEqual(before + 5_184_000_000);
    expect(calls[0]!.body).toMatchObject({ grant_type: 'authorization_code', code: 'c', client_secret: 'secret', redirect_uri: 'https://app/cb' });
    expect(query(calls[1]!.url)).toMatchObject({ grant_type: 'ig_exchange_token', client_secret: 'secret', access_token: 'short' });
  });

  it('accepts the flat token response as well', async () => {
    mockFetch([
      ['POST https://api.instagram.com/oauth/access_token', () => ({ access_token: 'short', user_id: 99 })],
      ['GET https://graph.instagram.com/access_token', (call) => ({ access_token: `long-from-${query(call.url).access_token}` })],
      [`GET ${GRAPH}/me`, () => ({ id: '99', user_id: '1784', username: 'praxis' })],
    ]);
    const [account] = await connector.exchange(client, { code: 'c', redirectUri: 'x' });
    expect(account!.credentials.accessToken).toBe('long-from-short');
  });

  it('publishes a single image', async () => {
    const calls = publishRoutes();
    const result = await instagram.publish(credentials, content('Hello', [image('a')]), { idempotencyKey: 'k' });
    expect(result).toEqual({ remoteId: 'm1', url: 'https://www.instagram.com/p/abc/' });
    expect(calls[0]!.body).toEqual({ image_url: 'https://cdn.example/a.jpg', caption: 'Hello', access_token: 'tok' });
    expect(calls[1]!.body).toEqual({ creation_id: 'c1', access_token: 'tok' });
  });

  it('publishes a single video as a reel once it is processed', async () => {
    const calls = publishRoutes(['IN_PROGRESS', 'IN_PROGRESS', 'FINISHED']);
    await instagram.publish(credentials, content('clip', [video('v')]), { idempotencyKey: 'k' });
    expect(calls[0]!.body).toMatchObject({ media_type: 'REELS', video_url: 'https://cdn.example/v.mp4', caption: 'clip' });
    expect(calls.filter((call) => call.url.startsWith(`${GRAPH}/c1?`))).toHaveLength(3);
    expect(query(calls[1]!.url).fields).toBe('status_code,status');
    expect(calls.at(-2)!.body).toMatchObject({ creation_id: 'c1' });
  });

  it('publishes carousels of images and videos', async () => {
    const calls = publishRoutes(['IN_PROGRESS', 'FINISHED']);
    await instagram.publish(credentials, content('set', [image('a'), video('v')]), { idempotencyKey: 'k' });
    const creates = calls.filter((call) => call.method === 'POST' && call.url === `${GRAPH}/1784/media`);
    expect(creates.map((call) => call.body)).toEqual([
      { is_carousel_item: 'true', image_url: 'https://cdn.example/a.jpg', access_token: 'tok' },
      { is_carousel_item: 'true', media_type: 'VIDEO', video_url: 'https://cdn.example/v.mp4', access_token: 'tok' },
      { media_type: 'CAROUSEL', children: 'c1,c2', caption: 'set', access_token: 'tok' },
    ]);
    // The video child is awaited before the carousel is created, then the carousel itself.
    expect(calls.filter((call) => call.method === 'GET' && call.url.startsWith(`${GRAPH}/c2?`))).toHaveLength(2);
    expect(calls.filter((call) => call.method === 'GET' && call.url.startsWith(`${GRAPH}/c3?`))).toHaveLength(1);
    expect(calls.find((call) => call.url.endsWith('/media_publish'))!.body).toMatchObject({ creation_id: 'c3' });
  });

  it('fails without retrying when processing fails', async () => {
    mockFetch([
      [`POST ${GRAPH}/1784/media`, () => ({ id: 'c1' })],
      [`GET ${GRAPH}/c1`, () => ({ status_code: 'ERROR', status: 'Error: unsupported codec' })],
    ]);
    await expect(instagram.publish(credentials, content('', [video('v')]), { idempotencyKey: 'k' })).rejects.toMatchObject({
      message: expect.stringContaining('unsupported codec'),
      retryable: false,
    });
  });

  it('asks for a reconnect when the token was revoked', async () => {
    mockFetch([[`POST ${GRAPH}/1784/media`, () => new Response(JSON.stringify({ error: { message: 'Session expired', code: 190 } }), { status: 400 })]]);
    await expect(instagram.publish(credentials, content('', [image('a')]), { idempotencyKey: 'k' })).rejects.toMatchObject({ needsReauth: true });
  });

  it('refreshes tokens in their last week', async () => {
    const now = Date.now();
    expect(instagram.needsRefresh!(credentials, now)).toBe(false);
    expect(instagram.needsRefresh!({ ...credentials, expiresAt: now + 3 * 86_400_000 }, now)).toBe(true);

    const calls = mockFetch([['GET https://graph.instagram.com/refresh_access_token', () => ({ access_token: 'new', expires_in: 5_184_000 })]]);
    const refreshed = await instagram.refresh!(credentials, undefined);
    expect(refreshed).toMatchObject({ accessToken: 'new', userId: '1784' });
    expect(refreshed.expiresAt).toBeGreaterThan(credentials.expiresAt);
    expect(query(calls[0]!.url)).toEqual({ grant_type: 'ig_refresh_token', access_token: 'tok' });

    mockFetch([['GET https://graph.instagram.com/refresh_access_token', () => new Response('{"error":{"message":"bad","code":100}}', { status: 400 })]]);
    await expect(instagram.refresh!(credentials, undefined)).rejects.toMatchObject({ needsReauth: true });
  });

  it('checks Instagram-specific rules', () => {
    const many = Array.from({ length: 6 }, (_, i) => [image(`i${i}`), video(`v${i}`)]).flat();
    expect(instagram.validate!(content('', many))).toContain('Instagram allows at most 10 images and videos per post.');
    expect(instagram.validate!(content('', [{ ...image('a'), mimeType: 'image/png' }]))).toContain('Instagram only accepts JPEG images.');
    const tags = Array.from({ length: 31 }, (_, i) => `#tag${i}`).join(' ');
    expect(instagram.validate!(content(tags, [image('a')]))).toContain('Instagram allows at most 30 hashtags.');
    expect(instagram.validate!(content('#ok', [image('a')]))).toEqual([]);
  });
});
