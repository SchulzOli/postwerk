import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalog } from '../src/catalog';
import { fetchMedia } from '../src/http';
import { mastodon } from '../src/mastodon';
import { formatBytes, validateContent } from '../src/validate';
import { imageResponse, mockFetch } from './helpers';

afterEach(() => vi.unstubAllGlobals());

const png = () => ({ blob: new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), mimeType: 'image/png' });

describe('fetchMedia', () => {
  it('reads uploads from storage instead of downloading them', async () => {
    const calls = mockFetch([]);
    const loaded = await fetchMedia({ url: 'https://app.test/media/x.png', kind: 'image' }, { loadMedia: async () => png() });
    expect(loaded.mimeType).toBe('image/png');
    expect(calls).toHaveLength(0);
  });

  it('downloads media that is not in storage', async () => {
    const calls = mockFetch([['GET https://cdn.example/', () => imageResponse()]]);
    const loaded = await fetchMedia({ url: 'https://cdn.example/a.png', kind: 'image' }, { loadMedia: async () => undefined });
    expect(loaded.blob.size).toBe(4);
    expect(calls.map((call) => call.url)).toEqual(['https://cdn.example/a.png']);
  });

  it('enforces the size limit for stored files too', async () => {
    await expect(fetchMedia({ url: 'x', kind: 'image' }, { loadMedia: async () => png() }, 2)).rejects.toThrow(/too large/);
  });
});

describe('media size limits', () => {
  it('formats sizes', () => {
    expect([formatBytes(1_000_000), formatBytes(5 * 1024 * 1024), formatBytes(1024 ** 3), formatBytes(300 * 1024)]).toEqual(['1 MB', '5 MB', '1 GB', '300 KB']);
  });

  it('explains when a file is too big for a network', () => {
    const content = (size: number) => ({ text: 'x', media: [{ url: 'u', kind: 'image' as const, size }], options: {} });
    expect(validateContent(catalog.bluesky, content(900_000))).toEqual([]);
    expect(validateContent(catalog.bluesky, content(2_000_000))).toEqual(['Bluesky accepts images up to 1 MB; one image is larger.']);
    // Unknown sizes (links) are not judged.
    expect(validateContent(catalog.bluesky, { text: 'x', media: [{ url: 'u', kind: 'image' }], options: {} })).toEqual([]);
  });
});

describe('mastodon with stored media', () => {
  it('uploads the stored bytes without fetching the public URL', async () => {
    const calls = mockFetch([
      ['POST https://social.example/api/v2/media', () => ({ id: 'm1', url: 'https://social.example/m1.png' })],
      ['POST https://social.example/api/v1/statuses', () => ({ id: 's1', url: 'https://social.example/@me/s1' })],
    ]);
    const result = await mastodon.publish(
      { instanceUrl: 'https://social.example', accessToken: 't' },
      { text: 'Hi', media: [{ url: 'https://app.test/media/a.png', kind: 'image', altText: 'A chart' }], options: {} },
      { idempotencyKey: 'k', loadMedia: async () => png() },
    );
    expect(result.remoteId).toBe('s1');
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(['POST https://social.example/api/v2/media', 'POST https://social.example/api/v1/statuses']);
    expect(calls[0]!.body).toMatchObject({ file: '<file 4>', description: 'A chart' });
  });
});
