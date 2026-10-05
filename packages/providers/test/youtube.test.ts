import { afterEach, describe, expect, it, vi } from 'vitest';
import { youtube, type YouTubeCredentials } from '../src/youtube';
import type { OAuthConnect } from '../src/types';
import { mockFetch } from './helpers';

const client = { clientId: 'cid', clientSecret: 'secret' };
const credentials: YouTubeCredentials = { accessToken: 'tok', refreshToken: 'rt', expiresAt: Date.now() + 3_600_000 };
const connector = youtube.connector as OAuthConnect<YouTubeCredentials>;
const content = (options: Record<string, string> = { title: 'Rückenübung' }) => ({
  text: 'Drei Minuten für den Rücken',
  media: [{ url: 'https://cdn.example/v.mp4', kind: 'video' as const }],
  options,
});
const videoResponse = () => new Response(new Blob([new Uint8Array(1234)], { type: 'video/mp4' }));
const quotaError = (reason: string) =>
  new Response(JSON.stringify({ error: { code: 403, message: 'The request cannot be completed because you have exceeded your <a href="/q">quota</a>.', errors: [{ reason }] } }), {
    status: 403,
  });

afterEach(() => vi.unstubAllGlobals());

describe('youtube', () => {
  it('builds an offline Google authorize URL', () => {
    const url = new URL(connector.authorizeUrl(client, { redirectUri: 'https://app/cb', state: 's' }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'cid',
      redirect_uri: 'https://app/cb',
      response_type: 'code',
      state: 's',
      scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    });
  });

  it('exchanges the code and returns every channel', async () => {
    const calls = mockFetch([
      ['POST https://oauth2.googleapis.com/token', () => ({ access_token: 'tok', refresh_token: 'rt', expires_in: 3599 })],
      [
        'GET https://www.googleapis.com/youtube/v3/channels',
        () => ({
          items: [
            { id: 'UC1', snippet: { title: 'Praxis', customUrl: '@praxis', thumbnails: { default: { url: 'https://pic/1' } } } },
            { id: 'UC2', snippet: { title: 'Praxis Shorts' } },
          ],
        }),
      ],
    ]);
    const accounts = await connector.exchange(client, { code: 'c', redirectUri: 'https://app/cb' });
    expect(accounts.map((account) => account.profile)).toEqual([
      { externalId: 'UC1', handle: '@praxis', displayName: 'Praxis', avatarUrl: 'https://pic/1' },
      { externalId: 'UC2', handle: 'Praxis Shorts', displayName: 'Praxis Shorts', avatarUrl: undefined },
    ]);
    expect(accounts[0]!.credentials).toMatchObject({ accessToken: 'tok', refreshToken: 'rt' });
    expect(calls[0]!.body).toMatchObject({ grant_type: 'authorization_code', code: 'c', client_id: 'cid', client_secret: 'secret' });
    expect(calls[1]!.url).toContain('mine=true');
    expect(calls[1]!.headers.authorization).toBe('Bearer tok');
  });

  it('rejects a login without a channel or with unticked scopes', async () => {
    mockFetch([
      ['POST https://oauth2.googleapis.com/token', () => ({ access_token: 'tok', expires_in: 3599 })],
      ['GET https://www.googleapis.com/youtube/v3/channels', () => ({ items: [] })],
    ]);
    await expect(connector.exchange(client, { code: 'c', redirectUri: 'x' })).rejects.toThrow(/no YouTube channel/);
    mockFetch([['POST https://oauth2.googleapis.com/token', () => ({ access_token: 'tok', scope: 'https://www.googleapis.com/auth/youtube.readonly' })]]);
    await expect(connector.exchange(client, { code: 'c', redirectUri: 'x' })).rejects.toThrow(/every permission/);
  });

  it('uploads with the resumable protocol', async () => {
    const calls = mockFetch([
      ['GET https://cdn.example/', () => videoResponse()],
      ['POST https://www.googleapis.com/upload/youtube/v3/videos', () => new Response(null, { status: 200, headers: { location: 'https://upload.example/session?id=1' } })],
      ['PUT https://upload.example/session', () => ({ id: 'vid123', status: { uploadStatus: 'uploaded' } })],
    ]);
    const result = await youtube.publish(credentials, content({ title: 'Rückenübung', privacy: 'unlisted' }), { idempotencyKey: 'k' });
    expect(result).toEqual({ remoteId: 'vid123', url: 'https://www.youtube.com/watch?v=vid123' });

    const [, init, upload] = calls;
    expect(init!.url).toContain('uploadType=resumable');
    expect(init!.headers).toMatchObject({ authorization: 'Bearer tok', 'x-upload-content-type': 'video/mp4', 'x-upload-content-length': '1234' });
    expect(init!.body).toMatchObject({
      snippet: { title: 'Rückenübung', description: 'Drei Minuten für den Rücken' },
      status: { privacyStatus: 'unlisted', selfDeclaredMadeForKids: false },
    });
    expect(upload!.body).toBe('<blob 1234>');
    expect(upload!.headers['content-type']).toBe('video/mp4');
  });

  it('defaults to public', async () => {
    const calls = mockFetch([
      ['GET https://cdn.example/', () => videoResponse()],
      ['POST https://www.googleapis.com/upload/youtube/v3/videos', () => new Response(null, { headers: { location: 'https://upload.example/s' } })],
      ['PUT https://upload.example/s', () => ({ id: 'v' })],
    ]);
    await youtube.publish(credentials, content(), { idempotencyKey: 'k' });
    expect(calls[1]!.body).toMatchObject({ status: { privacyStatus: 'public' } });
  });

  it('retries quota errors instead of asking for a reconnect', async () => {
    for (const reason of ['quotaExceeded', 'uploadLimitExceeded']) {
      mockFetch([
        ['GET https://cdn.example/', () => videoResponse()],
        ['POST https://www.googleapis.com/upload/youtube/v3/videos', () => quotaError(reason)],
      ]);
      const error = await youtube.publish(credentials, content(), { idempotencyKey: 'k' }).catch((e: unknown) => e);
      expect(error).toMatchObject({ retryable: true, needsReauth: false });
      expect((error as Error).message).not.toContain('<a');
    }
  });

  it('asks for a reconnect on revoked access', async () => {
    mockFetch([
      ['GET https://cdn.example/', () => videoResponse()],
      ['POST https://www.googleapis.com/upload/youtube/v3/videos', () => new Response(JSON.stringify({ error: { code: 401, message: 'Invalid Credentials', errors: [{ reason: 'authError' }] } }), { status: 401 })],
    ]);
    await expect(youtube.publish(credentials, content(), { idempotencyKey: 'k' })).rejects.toMatchObject({ needsReauth: true });
  });

  it('refreshes tokens and keeps the refresh token', async () => {
    expect(youtube.needsRefresh!({ ...credentials, expiresAt: Date.now() + 60_000 }, Date.now())).toBe(true);
    expect(youtube.needsRefresh!(credentials, Date.now())).toBe(false);
    const calls = mockFetch([['POST https://oauth2.googleapis.com/token', () => ({ access_token: 'new', expires_in: 3599 })]]);
    const refreshed = await youtube.refresh!(credentials, client);
    expect(refreshed).toMatchObject({ accessToken: 'new', refreshToken: 'rt' });
    expect(refreshed.expiresAt).toBeGreaterThan(Date.now());
    expect(calls[0]!.body).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'rt', client_id: 'cid' });
  });

  it('asks for a reconnect when the refresh token was revoked', async () => {
    mockFetch([['POST https://oauth2.googleapis.com/token', () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }), { status: 400 })]]);
    await expect(youtube.refresh!(credentials, client)).rejects.toMatchObject({ needsReauth: true, message: expect.stringContaining('revoked') });
    await expect(youtube.refresh!({ accessToken: 'tok' }, client)).rejects.toMatchObject({ needsReauth: true });
  });

  it('checks YouTube-specific text rules', () => {
    expect(youtube.validate!({ text: 'ok', media: [], options: { title: 'a <b>' } })).toEqual(['YouTube does not allow < or > in the title or description.']);
    expect(youtube.validate!({ text: 'ä'.repeat(3_000), media: [], options: { title: 't' } })).toHaveLength(1);
    expect(youtube.validate!({ text: 'a'.repeat(5_000), media: [], options: { title: 't' } })).toEqual([]);
  });
});
