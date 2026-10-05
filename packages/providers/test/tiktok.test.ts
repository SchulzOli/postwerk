import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tiktok, tiktokPolling, type TikTokCredentials } from '../src/tiktok';
import type { MediaItem, OAuthConnect } from '../src/types';
import { mockFetch } from './helpers';

const client = { clientId: 'ckey', clientSecret: 'secret' };
const credentials: TikTokCredentials = { accessToken: 'tok', refreshToken: 'rt', expiresAt: Date.now() + 86_400_000 };
const connector = tiktok.connector as OAuthConnect<TikTokCredentials>;
const API = 'https://open.tiktokapis.com/v2';
const ok = (data: unknown) => ({ data, error: { code: 'ok', message: '', log_id: 'l' } });
const video: MediaItem = { url: 'https://media.example/v.mp4', kind: 'video' };
const photos: MediaItem[] = [
  { url: 'https://media.example/1.jpg', kind: 'image' },
  { url: 'https://media.example/2.jpg', kind: 'image' },
];
const content = (media: MediaItem[], privacy = 'PUBLIC_TO_EVERYONE') => ({ text: 'Übung des Tages', media, options: { privacy } });
const creator = (overrides: Record<string, unknown> = {}) =>
  ok({
    creator_username: 'praxis',
    creator_nickname: 'Praxis',
    privacy_level_options: ['PUBLIC_TO_EVERYONE', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'],
    comment_disabled: false,
    duet_disabled: true,
    stitch_disabled: false,
    max_video_post_duration_sec: 600,
    ...overrides,
  });
// Post ids exceed Number.MAX_SAFE_INTEGER, so the mock returns raw JSON text.
const complete = () =>
  new Response(`{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7412345678901234567]},"error":{"code":"ok","message":""}}`, {
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => {
  tiktokPolling.intervalMs = 1;
  tiktokPolling.timeoutMs = 1_000;
});
afterEach(() => vi.unstubAllGlobals());

describe('tiktok', () => {
  it('builds the authorize URL with client_key', () => {
    const url = new URL(connector.authorizeUrl(client, { redirectUri: 'https://app/cb', state: 's' }));
    expect(url.origin + url.pathname).toBe('https://www.tiktok.com/v2/auth/authorize/');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_key: 'ckey',
      response_type: 'code',
      scope: 'user.info.basic,video.publish',
      redirect_uri: 'https://app/cb',
      state: 's',
    });
    expect(connector.pkce).toBe(false);
  });

  it('exchanges the code and reads the profile', async () => {
    const calls = mockFetch([
      [`POST ${API}/oauth/token/`, () => ({ access_token: 'tok', refresh_token: 'rt', expires_in: 86_400, open_id: 'oid', scope: 'user.info.basic,video.publish' })],
      [`GET ${API}/user/info/`, () => ok({ user: { open_id: 'oid', display_name: 'Praxis Ruhige Nähe', avatar_url: 'https://pic' } })],
      [`POST ${API}/post/publish/creator_info/query/`, () => creator()],
    ]);
    const [account] = await connector.exchange(client, { code: 'c', redirectUri: 'https://app/cb' });
    expect(account!.profile).toEqual({ externalId: 'oid', handle: '@praxis', displayName: 'Praxis Ruhige Nähe', avatarUrl: 'https://pic' });
    expect(account!.credentials).toMatchObject({ accessToken: 'tok', refreshToken: 'rt' });
    expect(calls[0]!.body).toMatchObject({ client_key: 'ckey', client_secret: 'secret', code: 'c', grant_type: 'authorization_code', redirect_uri: 'https://app/cb' });
    expect(calls[1]!.headers.authorization).toBe('Bearer tok');
  });

  it('rejects a login without the posting scope', async () => {
    mockFetch([[`POST ${API}/oauth/token/`, () => ({ access_token: 'tok', open_id: 'oid', scope: 'user.info.basic' })]]);
    await expect(connector.exchange(client, { code: 'c', redirectUri: 'x' })).rejects.toThrow(/permission to post/);
  });

  it('posts a video and waits until it is published', async () => {
    let checks = 0;
    const calls = mockFetch([
      [`POST ${API}/post/publish/creator_info/query/`, () => creator()],
      [`POST ${API}/post/publish/video/init/`, () => ok({ publish_id: 'v_pub_1' })],
      [`POST ${API}/post/publish/status/fetch/`, () => (++checks < 3 ? ok({ status: 'PROCESSING_DOWNLOAD' }) : complete())],
    ]);
    const result = await tiktok.publish(credentials, content([video]), { idempotencyKey: 'k' });
    expect(result).toEqual({ remoteId: '7412345678901234567', url: 'https://www.tiktok.com/@praxis/video/7412345678901234567' });
    expect(checks).toBe(3);
    expect(calls[1]!.body).toEqual({
      post_info: { title: 'Übung des Tages', privacy_level: 'PUBLIC_TO_EVERYONE', disable_comment: false, disable_duet: true, disable_stitch: false },
      source_info: { source: 'PULL_FROM_URL', video_url: 'https://media.example/v.mp4' },
    });
    expect(calls[2]!.body).toEqual({ publish_id: 'v_pub_1' });
  });

  it('posts a photo carousel', async () => {
    const calls = mockFetch([
      [`POST ${API}/post/publish/creator_info/query/`, () => creator()],
      [`POST ${API}/post/publish/content/init/`, () => ok({ publish_id: 'p_pub_1' })],
      [`POST ${API}/post/publish/status/fetch/`, () => complete()],
    ]);
    const result = await tiktok.publish(credentials, content(photos, 'SELF_ONLY'), { idempotencyKey: 'k' });
    expect(result.url).toBe('https://www.tiktok.com/@praxis/photo/7412345678901234567');
    expect(calls[1]!.body).toEqual({
      post_info: { description: 'Übung des Tages', privacy_level: 'SELF_ONLY', disable_comment: false },
      source_info: { source: 'PULL_FROM_URL', photo_images: ['https://media.example/1.jpg', 'https://media.example/2.jpg'], photo_cover_index: 0 },
      post_mode: 'DIRECT_POST',
      media_type: 'PHOTO',
    });
  });

  it('returns the publish id for private posts and slow processing', async () => {
    mockFetch([
      [`POST ${API}/post/publish/creator_info/query/`, () => creator()],
      [`POST ${API}/post/publish/video/init/`, () => ok({ publish_id: 'v_pub_2' })],
      [`POST ${API}/post/publish/status/fetch/`, () => ok({ status: 'PUBLISH_COMPLETE' })],
    ]);
    expect(await tiktok.publish(credentials, content([video], 'SELF_ONLY'), { idempotencyKey: 'k' })).toEqual({ remoteId: 'v_pub_2' });

    tiktokPolling.timeoutMs = 0;
    let checks = 0;
    mockFetch([
      [`POST ${API}/post/publish/creator_info/query/`, () => creator()],
      [`POST ${API}/post/publish/video/init/`, () => ok({ publish_id: 'v_pub_3' })],
      // A flaky status check must not fail the publish: the post is already on its way.
      [`POST ${API}/post/publish/status/fetch/`, () => (++checks === 1 ? new Response('{}', { status: 503 }) : ok({ status: 'PROCESSING_UPLOAD' }))],
    ]);
    expect(await tiktok.publish(credentials, content([video]), { idempotencyKey: 'k' })).toEqual({ remoteId: 'v_pub_3' });
  });

  it('rejects a visibility the creator cannot use before posting', async () => {
    const calls = mockFetch([[`POST ${API}/post/publish/creator_info/query/`, () => creator({ privacy_level_options: ['SELF_ONLY'] })]]);
    await expect(tiktok.publish(credentials, content([video], 'PUBLIC_TO_EVERYONE'), { idempotencyKey: 'k' })).rejects.toThrow(
      'TikTok does not allow "Everyone" for @praxis. Choose one of: "Only me".',
    );
    expect(calls).toHaveLength(1);
  });

  it('reports failed processing', async () => {
    mockFetch([
      [`POST ${API}/post/publish/creator_info/query/`, () => creator()],
      [`POST ${API}/post/publish/video/init/`, () => ok({ publish_id: 'v' })],
      [`POST ${API}/post/publish/status/fetch/`, () => ok({ status: 'FAILED', fail_reason: 'duration_check_failed' })],
    ]);
    await expect(tiktok.publish(credentials, content([video]), { idempotencyKey: 'k' })).rejects.toMatchObject({
      message: 'The video is too long or too short for this TikTok account.',
      retryable: false,
    });
  });

  it('maps API error codes, also on HTTP 200', async () => {
    const fail = (code: string, status = 200) => () => new Response(JSON.stringify({ data: {}, error: { code, message: code } }), { status });
    mockFetch([[`POST ${API}/post/publish/creator_info/query/`, fail('access_token_invalid', 401)]]);
    await expect(tiktok.publish(credentials, content([video]), { idempotencyKey: 'k' })).rejects.toMatchObject({ needsReauth: true });
    mockFetch([[`POST ${API}/post/publish/creator_info/query/`, fail('spam_risk_too_many_posts', 403)]]);
    await expect(tiktok.publish(credentials, content([video]), { idempotencyKey: 'k' })).rejects.toMatchObject({ retryable: true, needsReauth: false });
    mockFetch([
      [`POST ${API}/post/publish/creator_info/query/`, () => creator()],
      [`POST ${API}/post/publish/video/init/`, fail('unaudited_client_can_only_post_to_private_accounts', 403)],
    ]);
    await expect(tiktok.publish(credentials, content([video]), { idempotencyKey: 'k' })).rejects.toMatchObject({ retryable: false, needsReauth: false, message: expect.stringContaining('Only me') });
    mockFetch([[`POST ${API}/post/publish/creator_info/query/`, fail('rate_limit_exceeded')]]);
    await expect(tiktok.publish(credentials, content([video]), { idempotencyKey: 'k' })).rejects.toMatchObject({ retryable: true });
  });

  it('refreshes tokens with client_key', async () => {
    expect(tiktok.needsRefresh!({ ...credentials, expiresAt: Date.now() + 60_000 }, Date.now())).toBe(true);
    expect(tiktok.needsRefresh!(credentials, Date.now())).toBe(false);
    const calls = mockFetch([[`POST ${API}/oauth/token/`, () => ({ access_token: 'new', expires_in: 86_400, open_id: 'oid' })]]);
    expect(await tiktok.refresh!(credentials, client)).toMatchObject({ accessToken: 'new', refreshToken: 'rt' });
    expect(calls[0]!.body).toMatchObject({ client_key: 'ckey', grant_type: 'refresh_token', refresh_token: 'rt' });

    mockFetch([[`POST ${API}/oauth/token/`, () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Refresh token is invalid or expired.' }), { status: 400 })]]);
    await expect(tiktok.refresh!(credentials, client)).rejects.toMatchObject({ needsReauth: true });
  });

  it('only accepts JPEG and WebP photos', () => {
    expect(tiktok.validate!({ text: '', media: [{ url: 'x', kind: 'image', mimeType: 'image/png' }], options: {} })).toEqual(['TikTok photos must be JPEG or WebP.']);
    expect(tiktok.validate!({ text: '', media: [{ url: 'x', kind: 'image', mimeType: 'image/jpeg' }], options: {} })).toEqual([]);
  });
});
