import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { builtinThemes } from '../src/theme';
import { builtinMarket, builtinMarkets, listingProblems, MarketError, parseMarketManifest, type ListingDraft, type MarketManifest } from '../src/market';

const text = (en: string, de = `${en} (de)`) => ({ en, de });
const minimal = {
  kind: 'market',
  id: 'shop-apps',
  name: text('Shop apps'),
  description: text('Apps for online shops.'),
  product: { name: text('Shop app') },
  marketplace: {
    name: 'App Store',
    url: 'https://apps.example.com',
    listing: {
      texts: [{ id: 'name', label: text('Name'), max: 30 }],
      screenshots: { min: 1, max: 3, width: 1600, height: 900 },
    },
  },
  studio: text('Name the shop system correctly.'),
  results: { reach: text('Visits'), clicks: text('Installs started'), leads: text('Installs') },
};

function rejects(patch: Record<string, unknown>, message: RegExp) {
  expect(() => parseMarketManifest({ ...minimal, ...patch })).toThrow(MarketError);
  expect(() => parseMarketManifest({ ...minimal, ...patch })).toThrow(message);
}

const draft = (patch: Partial<ListingDraft> = {}): ListingDraft => ({
  texts: { name: 'Deposit Tracker', summary: 'Deposits, booked by themselves.', description: 'Books deposits.' },
  keywords: ['deposit'],
  screenshots: [{ caption: 'Orders' }, { caption: 'Statements' }, { caption: 'Returns' }],
  videos: 1,
  documents: 1,
  ...patch,
});

describe('built-in markets', () => {
  it('ships Business Central, valid and unchanged by a round trip', () => {
    expect(builtinMarkets.map((market) => market.id)).toEqual(['business-central']);
    for (const market of builtinMarkets) expect(parseMarketManifest(JSON.stringify(market))).toEqual(market);
  });

  it('keeps market ids apart from theme ids, since both share the plugin table', () => {
    const themeIds = new Set(builtinThemes.map((theme) => theme.id));
    expect(builtinMarkets.filter((market) => themeIds.has(market.id))).toEqual([]);
  });

  it('holds AppSource’s listing limits', () => {
    const { listing } = builtinMarket('business-central')!.marketplace;
    expect(Object.fromEntries(listing.texts.map((field) => [field.id, field.max]))).toEqual({ name: 200, summary: 100, description: 5000 });
    expect(listing.screenshots).toEqual({ min: 3, max: 5, width: 1280, height: 720 });
    expect(listing).toMatchObject({ keywords: { max: 3 }, videos: { max: 4 }, documents: { min: 1, max: 3 } });
  });
});

describe('parseMarketManifest', () => {
  it('accepts a minimal market and fills in defaults', () => {
    const market = parseMarketManifest(minimal);
    expect(market).toMatchObject({ id: 'shop-apps', version: '1.0.0', author: 'Unknown', templates: [], product: { fields: [] } });
    expect(market.marketplace.listing).toMatchObject({ keywords: { min: 0, max: 100 }, videos: { min: 0, max: 20 } });
    expect(market.marketplace.listing.texts[0]).toEqual({ id: 'name', label: text('Name'), max: 30, required: true, multiline: false });
  });

  it('explains invalid JSON and wrong kinds', () => {
    expect(() => parseMarketManifest('{ nope')).toThrow(/not valid JSON/);
    rejects({ kind: 'theme' }, /Set "kind": "market"/);
    rejects({ id: 'Not OK!' }, /lowercase letters/);
  });

  it('needs every text in English and German', () => {
    rejects({ name: 'Shop apps' }, /“name” needs a text for each language/);
    rejects({ name: { en: 'Shop apps' } }, /Add a “name.de”/);
  });

  it('checks profile fields', () => {
    const field = (patch: Record<string, unknown>) => ({ product: { name: text('Shop app'), fields: [{ id: 'plan', label: text('Plan'), ...patch }] } });
    rejects(field({ id: 'name' }), /Every profile already has “name”/);
    rejects(field({ id: 'Plan' }), /lowercase letters, digits and underscores/);
    rejects(field({ type: 'choice', options: [{ id: 'one', label: text('One') }] }), /list of 2 to/);
    rejects(field({ options: [] }), /only fields of type “choice”/);
    const market = parseMarketManifest({ ...minimal, ...field({ type: 'choices', options: [{ id: 'basic', label: text('Basic') }, { id: 'plus', label: text('Plus') }], required: true }) });
    expect(market.product.fields[0]).toMatchObject({ id: 'plan', type: 'choices', required: true });
  });

  it('checks the marketplace', () => {
    const marketplace = (patch: Record<string, unknown>) => ({ marketplace: { ...minimal.marketplace, ...patch } });
    rejects(marketplace({ url: 'http://apps.example.com' }), /https:\/\/ address/);
    rejects(marketplace({ listing: { ...minimal.marketplace.listing, texts: [] } }), /list of 1 to/);
    rejects(marketplace({ listing: { ...minimal.marketplace.listing, screenshots: { min: 4, max: 2, width: 1600, height: 900 } } }), /must not be larger/);
    const twice = { id: 'name', label: text('Name'), max: 30 };
    rejects(marketplace({ listing: { ...minimal.marketplace.listing, texts: [twice, twice] } }), /the id “name” twice/);
  });

  it('checks templates against the platform’s goals, channels and piece formats', () => {
    const template = (patch: Record<string, unknown>) => ({ templates: [{ id: 'launch', name: text('Launch'), description: text('Go live.'), ...patch }] });
    rejects(template({ goal: 'fame' }), /“templates\[0\].goal” must be one of/);
    rejects(template({ channels: ['billboards'] }), /“templates\[0\].channels” must be one of/);
    rejects(template({ pieces: [{ kind: 'ad', format: 'banner', title: text('Ad') }] }), /not a format of the piece kind “ad”/);
    const market = parseMarketManifest({ ...minimal, ...template({ channels: ['social', 'social'], pieces: [{ kind: 'listing', title: text('Listing') }, { kind: 'ad', format: 'search', title: text('Ad') }] }) });
    expect(market.templates[0]).toMatchObject({ goal: 'awareness', channels: ['social'], posts: 0, weeks: 4 });
    expect(market.templates[0]!.pieces).toEqual([{ kind: 'listing', title: text('Listing') }, { kind: 'ad', format: 'search', title: text('Ad') }]);
  });

  it('refuses manifests that are too big', () => {
    expect(() => parseMarketManifest(' '.repeat(200_001))).toThrow(/too big/);
  });
});

describe('the example in docs/markets.md', () => {
  it('is a valid market', () => {
    const page = readFileSync(new URL('../../../docs/markets.md', import.meta.url), 'utf8');
    const example = /```json\n([\s\S]*?)\n```/.exec(page)?.[1];
    expect(example).toBeDefined();
    const market = parseMarketManifest(example);
    expect(market).toMatchObject({ id: 'shop-apps', templates: [{ id: 'launch', goal: 'leads' }] });
    expect(market.marketplace.listing.documents).toEqual({ min: 0, max: 0 });
  });
});

describe('listingProblems', () => {
  const market = builtinMarket('business-central') as MarketManifest;

  it('passes a complete AppSource listing', () => {
    expect(listingProblems(market, draft())).toEqual([]);
  });

  it('reports missing and overlong texts', () => {
    const problems = listingProblems(market, draft({ texts: { name: ' ', summary: 'x'.repeat(101), description: 'Books deposits.' } }));
    expect(problems).toEqual([
      { code: 'required', field: 'name' },
      { code: 'tooLong', field: 'summary', max: 100, length: 101 },
    ]);
  });

  it('reports counts outside the marketplace’s limits and screenshots without a caption', () => {
    const problems = listingProblems(market, draft({ keywords: ['a', 'b', 'c', 'd', ' '], screenshots: [{ caption: 'Orders' }, { caption: '' }], videos: 0, documents: 0 }));
    expect(problems).toEqual([
      { code: 'count', field: 'keywords', min: 0, max: 3, actual: 4 },
      { code: 'count', field: 'screenshots', min: 3, max: 5, actual: 2 },
      { code: 'count', field: 'documents', min: 1, max: 3, actual: 0 },
      { code: 'caption', index: 1 },
    ]);
  });
});
