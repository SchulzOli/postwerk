import { describe, expect, it } from 'vitest';
import { connect, isAppPassword, normalizeHandle, postUrl } from '../src/bluesky';
import { catalog } from '../src/catalog';
import { validateContent } from '../src/validate';

describe('bluesky', () => {
  it('enforces the 300 grapheme limit', () => {
    const post = (text: string) => ({ text, media: [], options: {} });
    expect(validateContent(catalog.bluesky, post('👋'.repeat(300)))).toEqual([]);
    expect(validateContent(catalog.bluesky, post('a'.repeat(301)))).toHaveLength(1);
  });

  it('recognizes app passwords', () => {
    expect(isAppPassword('abcd-efgh-ijkl-mnop')).toBe(true);
    expect(isAppPassword('my-real-password')).toBe(false);
  });

  it('refuses main passwords before contacting the server', async () => {
    await expect(connect({ service: 'https://bsky.social', identifier: 'me.bsky.social', appPassword: 'hunter2' })).rejects.toThrow(/app password/);
  });

  it('normalizes handles and builds post URLs', () => {
    expect(normalizeHandle(' @me.bsky.social ')).toBe('me.bsky.social');
    expect(postUrl('at://did:plc:abc/app.bsky.feed.post/3kxyz', 'me.bsky.social')).toBe('https://bsky.app/profile/me.bsky.social/post/3kxyz');
  });
});
