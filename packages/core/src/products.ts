/**
 * Products: what a workspace sells in a target market, such as an extension
 * for Business Central. A product has the common profile fields and those
 * its market adds; listings, screenshots, templates and AI drafts build on it.
 */
import { and, asc, count, eq } from 'drizzle-orm';
import { campaigns, pieces, products, type Campaign, type Database, type Piece, type Product, type ProductProfile } from '@maas/db';
import { LocalizedError } from './i18n';
import { COMMON_PROFILE_FIELDS, listingProblems, type ListingProblem, type MarketManifest } from './market';
import { type ListingContent, type ScreenshotContent } from './marketing';
import { productMessages } from './messages';
import { listMarkets } from './plugins';

export class ProductError extends LocalizedError {
  constructor(pick: (m: (typeof productMessages)['en']) => string) {
    super((locale) => pick(productMessages[locale]));
  }
}

export type CommonProfileField = (typeof COMMON_PROFILE_FIELDS)[number];

/** How long each common field may be; "features" is a list, one per line in the form. */
export const COMMON_FIELD_LIMITS: Record<Exclude<CommonProfileField, 'name' | 'features'>, number> = {
  does: 600,
  audience: 600,
  countries: 300,
  languages: 300,
  price: 200,
  help: 300,
  privacy: 300,
  support: 300,
  video: 300,
};
export const MAX_FEATURES = 8;
export const FEATURE_CHARS = 200;
const NAME_CHARS = 120;
const MARKET_FIELD_CHARS = 300;

export interface ProductInput {
  name: string;
  profile: ProductProfile;
}

const asText = (value: string | string[] | undefined) => (Array.isArray(value) ? value.join('\n') : (value ?? '')).trim();
const asList = (value: string | string[] | undefined) => (Array.isArray(value) ? value : (value ?? '').split('\n')).map((entry) => entry.trim()).filter(Boolean);

/** Checks a product against its market and returns it in canonical form; unknown fields are dropped. */
export function cleanProduct(market: MarketManifest, input: ProductInput): ProductInput {
  const name = input.name.trim();
  if (!name) throw new ProductError((m) => m.name);
  if (name.length > NAME_CHARS) throw new ProductError((m) => m.tooLong({ field: 'name', max: NAME_CHARS }));
  const profile: ProductProfile = {};
  for (const [field, max] of Object.entries(COMMON_FIELD_LIMITS)) {
    const value = asText(input.profile[field]);
    if (value.length > max) throw new ProductError((m) => m.tooLong({ field, max }));
    if (value) profile[field] = value;
  }
  const features = asList(input.profile.features);
  if (features.length > MAX_FEATURES) throw new ProductError((m) => m.tooMany({ field: 'features', max: MAX_FEATURES }));
  if (features.some((feature) => feature.length > FEATURE_CHARS)) throw new ProductError((m) => m.tooLong({ field: 'features', max: FEATURE_CHARS }));
  if (features.length) profile.features = features;
  for (const field of market.product.fields) {
    const raw = input.profile[field.id];
    if (field.type === 'text') {
      const value = asText(raw);
      if (value.length > MARKET_FIELD_CHARS) throw new ProductError((m) => m.tooLong({ field: field.id, max: MARKET_FIELD_CHARS }));
      if (value) profile[field.id] = value;
      continue;
    }
    const allowed = new Set(field.options?.map((option) => option.id));
    const chosen = [...new Set((Array.isArray(raw) ? raw : raw ? [raw] : []).map((value) => value.trim()).filter(Boolean))];
    if (chosen.some((value) => !allowed.has(value))) throw new ProductError((m) => m.choice(field.id));
    if (field.type === 'choice' && chosen.length > 1) throw new ProductError((m) => m.choice(field.id));
    if (chosen.length) profile[field.id] = field.type === 'choice' ? chosen[0]! : chosen;
  }
  return { name, profile };
}

/** Profile fields a product still lacks before its listing can be approved: what it does, and its market's required fields. */
export function productProblems(market: MarketManifest, product: Pick<Product, 'profile'>): string[] {
  const empty = (id: string) => asText(product.profile[id]) === '';
  return ['does', ...market.product.fields.filter((field) => field.required).map((field) => field.id)].filter(empty);
}

export async function listProducts(db: Database, workspaceId: string): Promise<Product[]> {
  return db.query.products.findMany({ where: eq(products.workspaceId, workspaceId), orderBy: [asc(products.name), asc(products.createdAt)] });
}

export async function getProduct(db: Database, workspaceId: string, productId: string): Promise<Product | null> {
  return (await db.query.products.findFirst({ where: and(eq(products.id, productId), eq(products.workspaceId, workspaceId)) })) ?? null;
}

/** The installed market a product belongs to; undefined while that market is not installed. */
export async function installedMarket(db: Database, workspaceId: string, marketId: string): Promise<MarketManifest | undefined> {
  return (await listMarkets(db, workspaceId)).find((market) => market.id === marketId)?.manifest;
}

export async function createProduct(db: Database, workspaceId: string, marketId: string, input: ProductInput): Promise<Product> {
  const market = await installedMarket(db, workspaceId, marketId);
  if (!market) throw new ProductError((m) => m.marketNotInstalled);
  const [row] = await db
    .insert(products)
    .values({ workspaceId, marketId, ...cleanProduct(market, input) })
    .returning();
  return row!;
}

export async function updateProduct(db: Database, workspaceId: string, productId: string, input: ProductInput): Promise<Product> {
  const current = await getProduct(db, workspaceId, productId);
  if (!current) throw new ProductError((m) => m.notFound);
  const market = await installedMarket(db, workspaceId, current.marketId);
  if (!market) throw new ProductError((m) => m.marketNotInstalled);
  const [row] = await db
    .update(products)
    .set({ ...cleanProduct(market, input), updatedAt: new Date() })
    .where(and(eq(products.id, productId), eq(products.workspaceId, workspaceId)))
    .returning();
  return row!;
}

/** How many campaigns market a product. */
export async function productCampaignCount(db: Database, workspaceId: string, productId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(campaigns).where(and(eq(campaigns.workspaceId, workspaceId), eq(campaigns.productId, productId)));
  return row?.n ?? 0;
}

/** Deletes a product; its campaigns stay, without a product. */
export async function deleteProduct(db: Database, workspaceId: string, productId: string): Promise<Product | undefined> {
  const [row] = await db
    .delete(products)
    .where(and(eq(products.id, productId), eq(products.workspaceId, workspaceId)))
    .returning();
  return row;
}

export interface CampaignMarket {
  product: Product;
  /** Undefined while the product's market is not installed. */
  market: MarketManifest | undefined;
}

/** The product a campaign markets and its market, if it markets one. */
export async function campaignMarket(db: Database, workspaceId: string, campaign: Pick<Campaign, 'productId'>): Promise<CampaignMarket | null> {
  if (!campaign.productId) return null;
  const product = await getProduct(db, workspaceId, campaign.productId);
  if (!product) return null;
  return { product, market: await installedMarket(db, workspaceId, product.marketId) };
}

/** A listing's draft for the market's checks: its own content and the campaign's screenshots. */
export function listingDraft(content: ListingContent, screenshots: Pick<Piece, 'content'>[]) {
  return {
    texts: content.texts ?? {},
    keywords: content.keywords ?? [],
    screenshots: screenshots.map((piece) => ({ caption: String((piece.content as unknown as ScreenshotContent).caption ?? '') })),
    videos: (content.videos ?? []).length,
    documents: (content.documents ?? []).length,
  };
}

export interface ListingCheck {
  market: MarketManifest;
  product: Product;
  /** What the listing lacks by the market's limits. */
  listing: ListingProblem[];
  /** Profile fields the product lacks. */
  profile: string[];
}

/** Everything that stands between a listing piece and its approval; null when its campaign has no installed market. */
export async function checkListing(db: Database, workspaceId: string, piece: Pick<Piece, 'campaignId' | 'content'>): Promise<ListingCheck | null> {
  const campaign = await db.query.campaigns.findFirst({ where: and(eq(campaigns.id, piece.campaignId), eq(campaigns.workspaceId, workspaceId)) });
  const context = campaign && (await campaignMarket(db, workspaceId, campaign));
  if (!context?.market) return null;
  const screenshots = await db.query.pieces.findMany({ where: and(eq(pieces.campaignId, piece.campaignId), eq(pieces.kind, 'screenshot')), orderBy: [asc(pieces.createdAt)] });
  return {
    market: context.market,
    product: context.product,
    listing: listingProblems(context.market, listingDraft(piece.content as unknown as ListingContent, screenshots)),
    profile: productProblems(context.market, context.product),
  };
}
