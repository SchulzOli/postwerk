import { existsSync, readFileSync } from 'node:fs';
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

  it('link every network to an existing guide and heading on the docs site', () => {
    expect(guideUrl(catalog.instagram)).toBe('https://schulzoli.github.io/postwerk/networks/meta#instagram');
    // Headings become anchors like the docs site makes them: lowercase, spaces → "-".
    const slug = (heading: string) => heading.trim().toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
    for (const info of providerInfos) {
      const [path, anchor] = info.setup.guide.split('#');
      const file = new URL(`../../../docs/${path}.md`, import.meta.url);
      expect(existsSync(file), `${info.id}: docs/${path}.md`).toBe(true);
      if (!anchor) continue;
      const headings = readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => /^#{2,3} /.test(line))
        .map((line) => slug(line.replace(/^#+ /, '')));
      expect(headings, `${info.id}: #${anchor}`).toContain(anchor);
    }
  });
});
