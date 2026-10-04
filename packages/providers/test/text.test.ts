import { describe, expect, it } from 'vitest';
import { graphemeLength, mastodonLength } from '../src/text';

describe('graphemeLength', () => {
  it('counts emoji and combined characters as one', () => {
    expect(graphemeLength('hi 👋🏽')).toBe(4);
    expect(graphemeLength('👨‍👩‍👧')).toBe(1);
  });
});

describe('mastodonLength', () => {
  it('counts every URL as 23 characters', () => {
    expect(mastodonLength('see https://example.com/a/very/long/path?with=query')).toBe(4 + 23);
  });
});
