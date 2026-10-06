import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isBridgeCredentials } from '../src/bridge';
import { zernio, zernioTiming } from '../src/bridges/zernio';
import { ProviderError } from '../src/types';
import { mockFetch } from './helpers';

const config = { apiKey: 'zk_test', baseUrl: 'https://zernio.test/api' };
const API = 'https://zernio.test/api/v1';
const credentials = { via: 'zernio' as const, accountId: 'acc_1', profileId: 'prof_1' };
const text = (value: string, options: Record<string, string> = {}) => ({ text: value, media: [], options });

const published = (url = 'https://x.com/me/status/123') =>
  ({ post: { _id: 'post_1', status: 'published', platforms: [{ platform: 'twitter', accountId: 'acc_1', status: 'published', platformPostId: '123', platformPostUrl: url }] } });

beforeEach(() => {
  zernioTiming.pollMs = 1;
});
afterEach(() => vi.unstubAllGlobals());

describe('zernio bridge', () => {
  it('publishes right away with the target as idempotency key', async () => {
    const calls = mockFetch([[`POST ${API}/posts`, () => published()]]);
    const result = await zernio.publish(config, 'x', credentials, text('Hello'), { idempotencyKey: 'target-1' });
    expect(result).toEqual({ remoteId: '123', url: 'https://x.com/me/status/123' });
    expect(calls[0]!.headers).toMatchObject({ authorization: 'Bearer zk_test', 'idempotency-key': 'target-1' });
    expect(calls[0]!.body).toEqual({ content: 'Hello', platforms: [{ platform: 'twitter', accountId: 'acc_1' }], publishNow: true });
  });

  it('uploads stored files and passes links on', async () => {
    const calls = mockFetch([
      [`POST ${API}/media/presign`, () => ({ uploadUrl: 'https://upload.test/put/1', publicUrl: 'https://cdn.zernio.test/1.png' })],
      ['PUT https://upload.test/put/1', () => new Response(null, { status: 200 })],
      [`POST ${API}/posts`, () => published()],
    ]);
    const media = [
      { url: 'https://app.test/media/w/a.png', kind: 'image' as const, altText: 'A chart' },
      { url: 'https://cdn.example/b.jpg', kind: 'image' as const },
    ];
    const loadMedia = async (item: { url: string }) =>
      item.url.startsWith('https://app.test/') ? { blob: new Blob([new Uint8Array(4)], { type: 'image/png' }), mimeType: 'image/png' } : undefined;
    await zernio.publish(config, 'instagram', credentials, { text: 'Look', media, options: {} }, { idempotencyKey: 'k', loadMedia });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([`POST ${API}/media/presign`, 'PUT https://upload.test/put/1', `POST ${API}/posts`]);
    expect(calls[0]!.body).toEqual({ filename: 'postwerk-1.png', contentType: 'image/png', size: 4 });
    expect(calls[1]!.headers['content-type']).toBe('image/png');
    expect(calls[2]!.body).toMatchObject({
      mediaItems: [
        { type: 'image', url: 'https://cdn.zernio.test/1.png', altText: 'A chart' },
        { type: 'image', url: 'https://cdn.example/b.jpg' },
      ],
      platforms: [{ platform: 'instagram', accountId: 'acc_1' }],
    });
  });

  it('refuses media Zernio cannot reach', async () => {
    mockFetch([]);
    await expect(zernio.publish(config, 'x', credentials, { text: 'x', media: [{ url: 'http://intranet/a.png', kind: 'image' }], options: {} }, { idempotencyKey: 'k' })).rejects.toThrow(
      /public https address/,
    );
  });

  it('sends the per-post fields each network needs', async () => {
    const calls = mockFetch([[`POST ${API}/posts`, () => published()]]);
    await zernio.publish(config, 'youtube', credentials, text('Video', { title: 'My video', privacy: 'unlisted' }), { idempotencyKey: 'a' });
    await zernio.publish(config, 'tiktok', credentials, text('Clip', { privacy: 'SELF_ONLY' }), { idempotencyKey: 'b' });
    await zernio.publish(config, 'reddit', credentials, text('Body', { subreddit: 'physio', title: 'Hi' }), { idempotencyKey: 'c' });
    await zernio.publish(config, 'linkedin_page', credentials, text('Hello'), { idempotencyKey: 'd' });
    const targets = calls.map((call) => (call.body as { platforms: unknown[] }).platforms[0]);
    expect(targets).toEqual([
      { platform: 'youtube', accountId: 'acc_1', platformSpecificData: { title: 'My video', visibility: 'unlisted' } },
      { platform: 'tiktok', accountId: 'acc_1', platformSpecificData: { privacyLevel: 'SELF_ONLY', contentPreviewConfirmed: true, expressConsentGiven: true } },
      { platform: 'reddit', accountId: 'acc_1', platformSpecificData: { subreddit: 'physio', title: 'Hi' } },
      { platform: 'linkedin', accountId: 'acc_1' },
    ]);
  });

  it('waits for posts that are still processing', async () => {
    let checks = 0;
    mockFetch([
      [`POST ${API}/posts`, () => ({ post: { _id: 'post_1', platforms: [{ accountId: 'acc_1', status: 'processing' }] } })],
      [`GET ${API}/posts/post_1`, () => (++checks < 3 ? { post: { _id: 'post_1', platforms: [{ accountId: 'acc_1', status: 'uploading' }] } } : published('https://youtu.be/v1'))],
    ]);
    const result = await zernio.publish(config, 'youtube', credentials, text('Video', { title: 'T' }), { idempotencyKey: 'k' });
    expect(result.url).toBe('https://youtu.be/v1');
    expect(checks).toBe(3);
  });

  it('turns failures into retry, reconnect or give up', async () => {
    const failing = (category: string) =>
      new Response(JSON.stringify({ post: { _id: 'p', platforms: [{ accountId: 'acc_1', status: 'failed', errorMessage: 'nope', errorCategory: category }] }, error: 'Publish failed' }), {
        status: 207,
        headers: { 'content-type': 'application/json' },
      });
    const outcome = async (category: string) => {
      mockFetch([[`POST ${API}/posts`, () => failing(category)]]);
      const error = (await zernio.publish(config, 'x', credentials, text('x'), { idempotencyKey: 'k' }).catch((caught: unknown) => caught)) as ProviderError;
      return [error.message, error.retryable, error.needsReauth];
    };
    expect(await outcome('auth_expired')).toEqual(['Zernio: nope', false, true]);
    expect(await outcome('platform_rate_limit')).toEqual(['Zernio: nope', true, false]);
    expect(await outcome('user_content')).toEqual(['Zernio: nope', false, false]);
  });

  it('blames the API key on the server, not on the account', async () => {
    const status = async (code: number, body: object) => {
      mockFetch([[`POST ${API}/posts`, () => new Response(JSON.stringify(body), { status: code })]]);
      return zernio.publish(config, 'x', credentials, text('x'), { idempotencyKey: 'k' }).catch((caught: ProviderError) => caught);
    };
    expect(await status(401, { error: 'Invalid API key' })).toMatchObject({ needsReauth: false, retryable: true, message: expect.stringMatching(/ZERNIO_API_KEY/) });
    expect(await status(400, { error: 'Account disconnected', code: 'ACCOUNT_DISCONNECTED' })).toMatchObject({ needsReauth: true });
    expect(await status(429, { error: 'Slow down' })).toMatchObject({ retryable: true, needsReauth: false });
    expect(await status(400, { error: 'Content too long' })).toMatchObject({ retryable: false, needsReauth: false, message: 'Zernio: Content too long' });
  });

  it('manages profiles and accounts', async () => {
    const calls = mockFetch([
      [`POST ${API}/profiles`, () => ({ profile: { _id: 'prof_9' } })],
      [`GET ${API}/connect/twitter`, () => ({ authUrl: 'https://zernio.test/oauth/x?state=s' })],
      [
        `GET ${API}/accounts`,
        () => ({ accounts: [{ _id: 'acc_1', platform: 'twitter', username: 'me', displayName: 'Me', profilePicture: 'https://img/me.png', platformUserId: '42', isActive: true }] }),
      ],
      [`DELETE ${API}/accounts/acc_gone`, () => new Response('{"error":"Not found"}', { status: 404 })],
    ]);
    expect(await zernio.createProfile(config, 'Praxis')).toBe('prof_9');
    expect(await zernio.connectUrl(config, { profileId: 'prof_9', network: 'x', redirectUrl: 'https://app.test/api/bridge/callback?state=abc' })).toBe('https://zernio.test/oauth/x?state=s');
    expect(await zernio.listAccounts(config, 'prof_9', 'x')).toEqual([
      { id: 'acc_1', platform: 'twitter', username: 'me', displayName: 'Me', avatarUrl: 'https://img/me.png', platformUserId: '42', active: true },
    ]);
    await zernio.disconnect(config, 'acc_gone');
    const connect = new URL(calls[1]!.url);
    expect(Object.fromEntries(connect.searchParams)).toEqual({ profileId: 'prof_9', redirect_url: 'https://app.test/api/bridge/callback?state=abc' });
    expect(new URL(calls[2]!.url).searchParams.get('platform')).toBe('twitter');
  });

  it('recognizes bridged credentials', () => {
    expect(isBridgeCredentials(credentials)).toBe(true);
    expect(isBridgeCredentials({ accessToken: 'x' })).toBe(false);
    expect(isBridgeCredentials(null)).toBe(false);
  });
});
