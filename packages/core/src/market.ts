/**
 * Target market plugins: a market is a JSON manifest that sets the platform
 * up for one kind of product and the marketplace it is sold in, such as
 * extensions for Business Central on AppSource. It names the product and
 * the extra fields of its profile, the marketplace and the limits of a
 * listing there, campaign templates, guidance for the AI studio, and what
 * the result numbers mean. A workspace can install several markets.
 *
 * Manifests are data only (no code, no styles) and every text people see
 * is in English and German. Pure and browser-safe, like the theme format.
 * Format reference: docs/markets.md.
 */

import { LocalizedError, type Locale } from './i18n';
import { CHANNELS, GOALS, isPieceFormat, PIECE_KINDS, type Channel, type Goal, type PieceKind } from './marketing';
import { marketMessages } from './messages';

/** A text people see, in every language of the UI. */
export type MarketText = Record<Locale, string>;

export interface ProfileField {
  id: string;
  label: MarketText;
  hint?: MarketText;
  /** Free text, or one or more of the options. */
  type: 'text' | 'choice' | 'choices';
  options?: { id: string; label: MarketText }[];
  /** Has to be filled in before a listing can be approved. */
  required: boolean;
}

/** A text field of the marketplace listing and its limit in characters. */
export interface ListingText {
  id: string;
  label: MarketText;
  max: number;
  required: boolean;
  multiline: boolean;
}

/** How many of something a listing takes. */
export interface Count {
  min: number;
  max: number;
}

export interface Marketplace {
  /** A proper name, the same in every language, e.g. "AppSource". */
  name: string;
  url: string;
  listing: {
    texts: ListingText[];
    keywords: Count;
    screenshots: Count & { width: number; height: number };
    videos: Count;
    documents: Count;
  };
  /** What the marketplace checks that a computer cannot: shown before approval and given to the AI studio. */
  rules: MarketText[];
}

/** A piece a template creates: the marketplace listing, a listing screenshot, or a piece of the platform's own kinds. */
export interface TemplatePiece {
  kind: PieceKind | 'listing' | 'screenshot';
  format?: string;
  title: MarketText;
}

export interface CampaignTemplate {
  id: string;
  name: MarketText;
  description: MarketText;
  goal: Goal;
  /** Channels besides the marketplace, which every template of a market uses. */
  channels: Channel[];
  pieces: TemplatePiece[];
  /** Post drafts spread over the weeks. */
  posts: number;
  weeks: number;
}

export interface MarketManifest {
  kind: 'market';
  id: string;
  name: MarketText;
  version: string;
  author: string;
  description: MarketText;
  /** What is marketed, e.g. "Business Central extension", and the fields its profile adds to the common ones. */
  product: { name: MarketText; fields: ProfileField[] };
  marketplace: Marketplace;
  templates: CampaignTemplate[];
  /** Guidance for the AI studio, e.g. how the platform has to be named. */
  studio: MarketText;
  /** What reach, clicks and leads count in the marketplace. */
  results: { reach: MarketText; clicks: MarketText; leads: MarketText };
}

export class MarketError extends LocalizedError {
  constructor(pick: (m: (typeof marketMessages)['en']) => string) {
    super((locale) => pick(marketMessages[locale]));
  }
}

const ID = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const FIELD_ID = /^[a-z][a-z0-9_]{0,39}$/;
const MAX = { manifest: 200_000, name: 60, text: 300, long: 4000, list: 30, rules: 30, templates: 20 };
const LOCALES: Locale[] = ['en', 'de'];

/** Fields every product profile has, whatever its market; a market cannot redefine them. */
export const COMMON_PROFILE_FIELDS = ['name', 'does', 'audience', 'features', 'countries', 'languages', 'price', 'help', 'privacy', 'support', 'video'] as const;

type Raw = Record<string, unknown>;

function object(value: unknown, field: string): Raw {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MarketError((m) => m.object(field));
  return value as Raw;
}

function list(value: unknown, field: string, max: number, min = 0): unknown[] {
  if (value === undefined && min === 0) return [];
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new MarketError((m) => m.list({ field, min, max }));
  return value;
}

function plain(value: unknown, field: string, max: number, fallback?: string): string {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result) {
    if (fallback !== undefined) return fallback;
    throw new MarketError((m) => m.add(field));
  }
  if (result.length > max) throw new MarketError((m) => m.tooLong({ field, max }));
  return result;
}

/** A text in every language; a plain string is not enough, so nothing shows up untranslated. */
function translated(value: unknown, field: string, max: number): MarketText {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MarketError((m) => m.languages(field));
  const raw = value as Raw;
  return Object.fromEntries(LOCALES.map((locale) => [locale, plain(raw[locale], `${field}.${locale}`, max)])) as MarketText;
}

function count(value: unknown, field: string, limit: number): Count {
  const raw = object(value, field);
  const number = (key: 'min' | 'max', fallback: number) => {
    if (raw[key] === undefined) return fallback;
    const n = Number(raw[key]);
    if (!Number.isInteger(n) || n < 0 || n > limit) throw new MarketError((m) => m.number({ field: `${field}.${key}`, min: 0, max: limit }));
    return n;
  };
  const result = { min: number('min', 0), max: number('max', limit) };
  if (result.min > result.max) throw new MarketError((m) => m.range(field));
  return result;
}

function integer(value: unknown, field: string, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new MarketError((m) => m.number({ field, min, max }));
  return n;
}

function https(value: unknown, field: string): string {
  const url = plain(value, field, 300);
  if (!/^https:\/\/[^\s/]+\.[^\s]+$/.test(url)) throw new MarketError((m) => m.url(field));
  return url;
}

function uniqueIds<T extends { id: string }>(items: T[], field: string): T[] {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) throw new MarketError((m) => m.duplicate({ field, id: item.id }));
    seen.add(item.id);
  }
  return items;
}

function fieldId(value: unknown, field: string): string {
  const id = plain(value, field, 40);
  if (!FIELD_ID.test(id)) throw new MarketError((m) => m.fieldId(field));
  return id;
}

function profileField(value: unknown, index: number): ProfileField {
  const field = `product.fields[${index}]`;
  const raw = object(value, field);
  const id = fieldId(raw.id, `${field}.id`);
  if ((COMMON_PROFILE_FIELDS as readonly string[]).includes(id)) throw new MarketError((m) => m.commonField(id));
  const type = raw.type ?? 'text';
  if (type !== 'text' && type !== 'choice' && type !== 'choices') throw new MarketError((m) => m.choice({ field: `${field}.type`, allowed: 'text, choice, choices' }));
  const result: ProfileField = { id, label: translated(raw.label, `${field}.label`, MAX.name), type, required: raw.required === true };
  if (raw.hint !== undefined) result.hint = translated(raw.hint, `${field}.hint`, MAX.text);
  if (type === 'text') {
    if (raw.options !== undefined) throw new MarketError((m) => m.optionsOnlyForChoices(field));
  } else {
    const options = list(raw.options, `${field}.options`, MAX.list, 2).map((option, at) => {
      const entry = object(option, `${field}.options[${at}]`);
      return { id: fieldId(entry.id, `${field}.options[${at}].id`), label: translated(entry.label, `${field}.options[${at}].label`, MAX.name) };
    });
    result.options = uniqueIds(options, `${field}.options`);
  }
  return result;
}

function marketplace(value: unknown): Marketplace {
  const raw = object(value, 'marketplace');
  const listing = object(raw.listing, 'marketplace.listing');
  const texts = list(listing.texts, 'marketplace.listing.texts', MAX.list, 1).map((entry, index) => {
    const field = `marketplace.listing.texts[${index}]`;
    const text = object(entry, field);
    return {
      id: fieldId(text.id, `${field}.id`),
      label: translated(text.label, `${field}.label`, MAX.name),
      max: integer(text.max, `${field}.max`, 1, 100_000),
      required: text.required !== false,
      multiline: text.multiline === true,
    };
  });
  const screenshots = object(listing.screenshots, 'marketplace.listing.screenshots');
  return {
    name: plain(raw.name, 'marketplace.name', MAX.name),
    url: https(raw.url, 'marketplace.url'),
    listing: {
      texts: uniqueIds(texts, 'marketplace.listing.texts'),
      keywords: count(listing.keywords ?? {}, 'marketplace.listing.keywords', 100),
      screenshots: {
        ...count(screenshots, 'marketplace.listing.screenshots', 20),
        width: integer(screenshots.width, 'marketplace.listing.screenshots.width', 100, 8000),
        height: integer(screenshots.height, 'marketplace.listing.screenshots.height', 100, 8000),
      },
      videos: count(listing.videos ?? {}, 'marketplace.listing.videos', 20),
      documents: count(listing.documents ?? {}, 'marketplace.listing.documents', 20),
    },
    rules: list(raw.rules, 'marketplace.rules', MAX.rules).map((rule, index) => translated(rule, `marketplace.rules[${index}]`, MAX.text)),
  };
}

function template(value: unknown, index: number): CampaignTemplate {
  const field = `templates[${index}]`;
  const raw = object(value, field);
  const goal = raw.goal ?? 'awareness';
  if (!GOALS.includes(goal as Goal)) throw new MarketError((m) => m.choice({ field: `${field}.goal`, allowed: GOALS.join(', ') }));
  const channels = list(raw.channels, `${field}.channels`, CHANNELS.length).map((channel) => {
    if (!CHANNELS.includes(channel as Channel)) throw new MarketError((m) => m.choice({ field: `${field}.channels`, allowed: CHANNELS.join(', ') }));
    return channel as Channel;
  });
  const kinds = ['listing', 'screenshot', ...PIECE_KINDS];
  const pieces = list(raw.pieces, `${field}.pieces`, MAX.list).map((entry, at) => {
    const pieceField = `${field}.pieces[${at}]`;
    const piece = object(entry, pieceField);
    if (!kinds.includes(piece.kind as string)) throw new MarketError((m) => m.choice({ field: `${pieceField}.kind`, allowed: kinds.join(', ') }));
    const kind = piece.kind as TemplatePiece['kind'];
    const result: TemplatePiece = { kind, title: translated(piece.title, `${pieceField}.title`, MAX.name) };
    if (kind !== 'listing' && kind !== 'screenshot') {
      const format = plain(piece.format, `${pieceField}.format`, 40);
      if (!isPieceFormat(kind, format)) throw new MarketError((m) => m.format({ field: `${pieceField}.format`, kind }));
      result.format = format;
    }
    return result;
  });
  return {
    id: plain(raw.id, `${field}.id`, 40),
    name: translated(raw.name, `${field}.name`, MAX.name),
    description: translated(raw.description, `${field}.description`, MAX.text),
    goal: goal as Goal,
    channels: [...new Set(channels)],
    pieces,
    posts: integer(raw.posts ?? 0, `${field}.posts`, 0, 60),
    weeks: integer(raw.weeks ?? 4, `${field}.weeks`, 1, 52),
  };
}

/**
 * Validates a market manifest (an object or its JSON text) and returns it in
 * canonical form. Throws MarketError with a message meant for the user.
 */
export function parseMarketManifest(input: unknown): MarketManifest {
  let raw = input;
  if (typeof input === 'string') {
    if (input.length > MAX.manifest) throw new MarketError((m) => m.tooBig(MAX.manifest / 1000));
    try {
      raw = JSON.parse(input);
    } catch (error) {
      throw new MarketError((m) => m.notJson((error as Error).message));
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new MarketError((m) => m.notObject);
  const manifest = raw as Raw;
  if (manifest.kind !== 'market') throw new MarketError((m) => m.onlyMarkets);

  const id = plain(manifest.id, 'id', 40);
  if (!ID.test(id)) throw new MarketError((m) => m.idFormat);
  const product = object(manifest.product, 'product');
  const results = object(manifest.results, 'results');
  const templates = list(manifest.templates, 'templates', MAX.templates).map(template);

  return {
    kind: 'market',
    id,
    name: translated(manifest.name, 'name', MAX.name),
    version: plain(manifest.version, 'version', 20, '1.0.0'),
    author: plain(manifest.author, 'author', MAX.name, 'Unknown'),
    description: translated(manifest.description, 'description', MAX.text),
    product: {
      name: translated(product.name, 'product.name', MAX.name),
      fields: uniqueIds(list(product.fields, 'product.fields', MAX.list).map(profileField), 'product.fields'),
    },
    marketplace: marketplace(manifest.marketplace),
    templates: uniqueIds(templates, 'templates'),
    studio: translated(manifest.studio, 'studio', MAX.long),
    results: {
      reach: translated(results.reach, 'results.reach', MAX.name),
      clicks: translated(results.clicks, 'results.clicks', MAX.name),
      leads: translated(results.leads, 'results.leads', MAX.name),
    },
  };
}

/** A marketplace listing as people fill it in. */
export interface ListingDraft {
  texts: Record<string, string>;
  keywords: string[];
  screenshots: { caption: string }[];
  videos: number;
  documents: number;
}

export type ListingProblem =
  | { code: 'required'; field: string }
  | { code: 'tooLong'; field: string; max: number; length: number }
  | { code: 'count'; field: 'keywords' | 'screenshots' | 'videos' | 'documents'; min: number; max: number; actual: number }
  | { code: 'caption'; index: number };

/** What a listing still lacks, or has too much of, by the market's rules. An empty list means it can be approved. */
export function listingProblems(market: MarketManifest, draft: ListingDraft): ListingProblem[] {
  const { listing } = market.marketplace;
  const problems: ListingProblem[] = [];
  for (const text of listing.texts) {
    const value = (draft.texts[text.id] ?? '').trim();
    if (!value && text.required) problems.push({ code: 'required', field: text.id });
    else if (value.length > text.max) problems.push({ code: 'tooLong', field: text.id, max: text.max, length: value.length });
  }
  const counts = [
    ['keywords', draft.keywords.filter((keyword) => keyword.trim()).length, listing.keywords],
    ['screenshots', draft.screenshots.length, listing.screenshots],
    ['videos', draft.videos, listing.videos],
    ['documents', draft.documents, listing.documents],
  ] as const;
  for (const [field, actual, rule] of counts) {
    if (actual < rule.min || actual > rule.max) problems.push({ code: 'count', field, min: rule.min, max: rule.max, actual });
  }
  draft.screenshots.forEach((screenshot, index) => {
    if (!screenshot.caption.trim()) problems.push({ code: 'caption', index });
  });
  return problems;
}

export { builtinMarkets, builtinMarket } from './markets';
