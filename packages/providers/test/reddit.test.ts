import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeSubreddit, reddit, REDDIT_USER_AGENT, type RedditCredentials } from '../src/reddit';
import { type OAuthConnect } from '../src/types';
import { mockFetch } from './helpers';

const client = { clientId: 'cid', clientSecret: 'secret' };
const credentials: RedditCredentials = { accessToken: 'tok', refreshToken: 'r1', expiresAt: Date.now() + 3_600_000 };
const content = (options: Record<string, string>, text = 'Body') => ({ text, media: [], options });
const connector = reddit.connector as OAuthConnect<RedditCredentials>;
const submitted = (data: object) => ({ json: { errors: [], data } });

afterEach(() => vi.unstubAllGlobals());

describe('reddit', () => {
  it('normalizes subreddit names', () => {
    expect(normalizeSubreddit(' r/physio ')).toBe('physio');
    expect(normalizeSubreddit('/r/physio')).toBe('physio');
    expect(normalizeSubreddit('physio')).toBe('physio');
  });

  it('builds the authorize URL for a permanent grant', () => {
    const url = new URL(connector.authorizeUrl(client, { redirectUri: 'https://app/cb', state: 's' }));
    expect(url.origin + url.pathname).toBe('https://www.reddit.com/api/v1/authorize');
    expect(url.searchParams.get('scope')).toBe('identity submit');
    expect(url.searchParams.get('duration')).toBe('permanent');
    expect(url.searchParams.get('client_id')).toBe('cid');
  });

  it('exchanges the code with a user agent and reads the profile', async () => {
    const calls = mockFetch([
      ['POST https://www.reddit.com/api/v1/access_token', () => ({ access_token: 'tok', refresh_token: 'r1', expires_in: 3600 })],
      ['GET https://oauth.reddit.com/api/v1/me', () => ({ id: 'abc', name: 'oli', icon_img: 'https://styles.redditmedia.com/a.png?width=256&amp;s=1' })],
    ]);
    const [account] = await connector.exchange(client, { code: 'c', redirectUri: 'https://app/cb' });
    expect(account!.profile).toEqual({ externalId: 'abc', handle: 'u/oli', displayName: 'oli', avatarUrl: 'https://styles.redditmedia.com/a.png?width=256&s=1' });
    expect(account!.credentials).toMatchObject({ accessToken: 'tok', refreshToken: 'r1' });
    expect(calls[0]!.body).toEqual({ grant_type: 'authorization_code', code: 'c', redirect_uri: 'https://app/cb' });
    expect(calls[0]!.headers).toMatchObject({ authorization: `Basic ${btoa('cid:secret')}`, 'user-agent': REDDIT_USER_AGENT });
    expect(calls[1]!.headers).toMatchObject({ authorization: 'Bearer tok', 'user-agent': REDDIT_USER_AGENT });
  });

  it('treats a 200 token error as a failed connect', async () => {
    mockFetch([['POST https://www.reddit.com/api/v1/access_token', () => ({ error: 'invalid_grant' })]]);
    await expect(connector.exchange(client, { code: 'c', redirectUri: 'x' })).rejects.toMatchObject({ needsReauth: true });
  });

  it('submits self posts', async () => {
    const calls = mockFetch([
      ['POST https://oauth.reddit.com/api/submit', () => submitted({ id: 'xyz', name: 't3_xyz', url: 'https://www.reddit.com/r/physio/comments/xyz/hi/' })],
    ]);
    const result = await reddit.publish(credentials, content({ subreddit: 'r/physio', title: 'Hi' }), { idempotencyKey: 'k' });
    expect(result).toEqual({ remoteId: 't3_xyz', url: 'https://www.reddit.com/r/physio/comments/xyz/hi/' });
    expect(calls[0]!.body).toEqual({ sr: 'physio', kind: 'self', title: 'Hi', text: 'Body', api_type: 'json', resubmit: 'true' });
    expect(calls[0]!.headers).toMatchObject({ authorization: 'Bearer tok', 'user-agent': REDDIT_USER_AGENT });
  });

  it('validates the subreddit name', () => {
    expect(reddit.validate!(content({ subreddit: 'r/physio_therapy', title: 't' }))).toEqual([]);
    expect(reddit.validate!(content({ subreddit: 'not a sub', title: 't' }))).toHaveLength(1);
  });

  it('maps errors in the 200 response', async () => {
    mockFetch([['POST https://oauth.reddit.com/api/submit', () => ({ json: { errors: [['SUBREDDIT_NOEXIST', 'that subreddit doesn’t exist', 'sr']] } })]]);
    await expect(reddit.publish(credentials, content({ subreddit: 'nope', title: 't' }), { idempotencyKey: 'k' })).rejects.toMatchObject({
      message: 'Reddit rejected the post: that subreddit doesn’t exist',
      retryable: false,
      needsReauth: false,
    });

    mockFetch([['POST https://oauth.reddit.com/api/submit', () => ({ json: { errors: [['RATELIMIT', 'Take a break for 3 minutes.', 'ratelimit']] } })]]);
    await expect(reddit.publish(credentials, content({ subreddit: 'physio', title: 't' }), { idempotencyKey: 'k' })).rejects.toMatchObject({
      retryable: true,
    });

    mockFetch([['POST https://oauth.reddit.com/api/submit', () => new Response('{"message":"Unauthorized","error":401}', { status: 401 })]]);
    await expect(reddit.publish(credentials, content({ subreddit: 'physio', title: 't' }), { idempotencyKey: 'k' })).rejects.toMatchObject({
      needsReauth: true,
    });
  });

  it('refreshes and keeps the permanent refresh token', async () => {
    expect(reddit.needsRefresh!({ ...credentials, expiresAt: Date.now() }, Date.now())).toBe(true);
    expect(reddit.needsRefresh!(credentials, Date.now())).toBe(false);
    const calls = mockFetch([['POST https://www.reddit.com/api/v1/access_token', () => ({ access_token: 'tok2', expires_in: 3600 })]]);
    const refreshed = await reddit.refresh!(credentials, client);
    expect(refreshed).toMatchObject({ accessToken: 'tok2', refreshToken: 'r1' });
    expect(calls[0]!.body).toEqual({ grant_type: 'refresh_token', refresh_token: 'r1' });
    expect(calls[0]!.headers['user-agent']).toBe(REDDIT_USER_AGENT);
  });

  it('asks for a reconnect when the grant is revoked', async () => {
    mockFetch([['POST https://www.reddit.com/api/v1/access_token', () => new Response('{"error":"invalid_grant"}', { status: 400 })]]);
    await expect(reddit.refresh!(credentials, client)).rejects.toMatchObject({ needsReauth: true });
  });
});
