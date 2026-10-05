import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalog } from '../src/catalog';
import { authorizeUrl, mastodon, normalizeInstanceUrl } from '../src/mastodon';
import { validateContent } from '../src/validate';
import { ProviderError } from '../src/types';

const credentials = { instanceUrl: 'https://social.example', accessToken: 'token-123' };

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('normalizeInstanceUrl', () => {
  it('accepts bare hostnames and strips paths', () => {
    expect(normalizeInstanceUrl(' mastodon.social ')).toBe('https://mastodon.social');
    expect(normalizeInstanceUrl('https://mastodon.social/@user')).toBe('https://mastodon.social');
  });

  it('rejects plain http and garbage', () => {
    expect(() => normalizeInstanceUrl('http://mastodon.social')).toThrow(ProviderError);
    expect(() => normalizeInstanceUrl('')).toThrow(ProviderError);
    expect(() => normalizeInstanceUrl('exa mple')).toThrow(ProviderError);
  });
});

describe('authorizeUrl', () => {
  it('builds the OAuth authorize URL', () => {
    const url = new URL(authorizeUrl('https://social.example', { clientId: 'cid', clientSecret: 's' }, 'https://app/cb', 'st'));
    expect(url.origin + url.pathname).toBe('https://social.example/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: 'cid', redirect_uri: 'https://app/cb', state: 'st', response_type: 'code' });
  });
});

describe('mastodon validation', () => {
  const post = (text: string) => ({ text, media: [], options: {} });
  it('uses the per-server limit', () => {
    expect(validateContent(catalog.mastodon, post('a'.repeat(501)))).toHaveLength(1);
    expect(validateContent(catalog.mastodon, post('a'.repeat(501)), { maxLength: 1000 })).toEqual([]);
    expect(validateContent(catalog.mastodon, post('   '))).toEqual(['Add some text or media.']);
  });
});

describe('mastodon.publish', () => {
  it('posts the status with an idempotency key', async () => {
    const fetchMock = mockFetch(200, { id: '42', url: 'https://social.example/@me/42' });
    const result = await mastodon.publish(credentials, { text: 'Hello', media: [], options: {} }, { idempotencyKey: 'target-1' });

    expect(result).toEqual({ remoteId: '42', url: 'https://social.example/@me/42' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://social.example/api/v1/statuses');
    expect(init.headers).toMatchObject({ authorization: 'Bearer token-123', 'idempotency-key': 'target-1' });
    expect(JSON.parse(init.body as string)).toEqual({ status: 'Hello', media_ids: [], visibility: 'public' });
  });

  it('flags revoked tokens as needing reauth', async () => {
    mockFetch(401, { error: 'The access token was revoked' });
    const error = await mastodon.publish(credentials, { text: 'x', media: [], options: {} }, { idempotencyKey: 'k' }).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ needsReauth: true, retryable: false });
    expect(error.message).toContain('revoked');
  });

  it('treats rate limits and server errors as retryable', async () => {
    mockFetch(429, { error: 'Too many requests' });
    await expect(mastodon.publish(credentials, { text: 'x', media: [], options: {} }, { idempotencyKey: 'k' })).rejects.toMatchObject({ retryable: true });
    mockFetch(503, 'down');
    await expect(mastodon.publish(credentials, { text: 'x', media: [], options: {} }, { idempotencyKey: 'k' })).rejects.toMatchObject({ retryable: true });
  });

  it('treats validation errors as permanent', async () => {
    mockFetch(422, { error: 'Validation failed: Text character limit of 500 exceeded' });
    await expect(mastodon.publish(credentials, { text: 'x', media: [], options: {} }, { idempotencyKey: 'k' })).rejects.toMatchObject({ retryable: false, needsReauth: false });
  });

  it('treats network failures as retryable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    await expect(mastodon.publish(credentials, { text: 'x', media: [], options: {} }, { idempotencyKey: 'k' })).rejects.toMatchObject({ retryable: true });
  });
});
