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

import { getProvider, PROVIDER_IDS } from '../src/index';

describe('registry', () => {
  it('has a provider for every id, matching its catalog entry', () => {
    for (const id of PROVIDER_IDS) expect(getProvider(id).id).toBe(id);
  });
});
