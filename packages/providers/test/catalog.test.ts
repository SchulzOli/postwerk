import { describe, expect, it } from 'vitest';
import { catalog, guideUrl, providerInfos } from '../src/catalog';
import { localizeInfo } from '../src/messages';

describe('setup notes', () => {
  it('say what an operator app needs for own accounts and for other people’s, in both languages', () => {
    for (const info of providerInfos.filter((entry) => entry.setup.operator === 'operator-app')) {
      expect(info.setup.envPrefix, info.id).toMatch(/^[A-Z_]+$/);
      expect(info.setup.ownUse, info.id).toBeTruthy();
      expect(info.setup.review, info.id).toBeTruthy();
      const german = localizeInfo(info, 'de').setup;
      expect(german.ownUse, info.id).not.toBe(info.setup.ownUse);
      expect(german.review, info.id).not.toBe(info.setup.review);
    }
  });

  it('link every network to its guide on the docs site', () => {
    expect(guideUrl(catalog.instagram)).toBe('https://schulzoli.github.io/postwerk/networks/meta#instagram');
    for (const info of providerInfos) expect(info.setup.guide, info.id).toMatch(/^[a-z-]+(\/[a-z-]+)?(#[a-z-]+)?$/);
  });
});
