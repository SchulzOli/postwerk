import { eq } from 'drizzle-orm';
import { brandKits, type BrandCharacter, type BrandColors, type BrandKit, type Database } from '@maas/db';
import { LocalizedError } from './i18n';
import { findMedia } from './media';
import { brandMessages } from './messages';

type Texts = (typeof brandMessages)['en'];
type Field = keyof Texts['fields'];

/** A brand kit entry the user has to fix; the message is meant for the user. */
export class BrandError extends LocalizedError {
  constructor(pick: (m: Texts) => string) {
    super((locale) => pick(brandMessages[locale]));
  }
}

export const DEFAULT_BRAND_COLORS: BrandColors = { primary: '#3b5bdb', secondary: '#1e293b', accent: '#f59e0b', text: '#111827', background: '#ffffff' };
export const BRAND_FONTS = ['sans', 'serif'] as const;
export const MAX_CHARACTER_PICTURES = 6;

const LIMITS: Record<Exclude<Field, keyof BrandColors>, number> = {
  companyName: 120,
  tagline: 160,
  description: 2000,
  audience: 1000,
  tone: 1000,
  dos: 2000,
  donts: 2000,
  website: 300,
  email: 200,
  phone: 40,
  address: 400,
  name: 80,
  role: 160,
  look: 2000,
  personality: 1000,
  voice: 600,
  catchphrase: 200,
  rules: 1000,
};

export interface BrandKitInput {
  companyName: string;
  tagline: string;
  description: string;
  audience: string;
  tone: string;
  dos: string;
  donts: string;
  colors: BrandColors;
  font: string;
  logoMediaId: string | null;
  website: string;
  email: string;
  phone: string;
  address: string;
  /** null when the brand has no character. */
  character: BrandCharacter | null;
}

/** A workspace's brand kit, or a starting point named after the workspace when none was saved yet. */
export async function getBrandKit(db: Database, workspace: { id: string; name: string }): Promise<BrandKit> {
  const row = await db.query.brandKits.findFirst({ where: eq(brandKits.workspaceId, workspace.id) });
  return (
    row ?? {
      workspaceId: workspace.id,
      companyName: workspace.name,
      tagline: '',
      description: '',
      audience: '',
      tone: '',
      dos: '',
      donts: '',
      colors: DEFAULT_BRAND_COLORS,
      font: 'sans',
      logoMediaId: null,
      website: '',
      email: '',
      phone: '',
      address: '',
      character: null,
      mediaIds: [],
      updatedAt: new Date(0),
    }
  );
}

function text(value: string, field: Exclude<Field, keyof BrandColors>): string {
  const trimmed = value.trim();
  if (trimmed.length > LIMITS[field]) throw new BrandError((m) => m.tooLong({ field: m.fields[field], max: LIMITS[field] }));
  return trimmed;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Checks and cleans a brand kit (trimmed texts, lowercase colors); throws BrandError with what to fix. */
export function cleanBrandKit(input: BrandKitInput): BrandKitInput {
  const companyName = text(input.companyName, 'companyName');
  if (!companyName) throw new BrandError((m) => m.companyName);
  const colors = {} as BrandColors;
  for (const key of Object.keys(DEFAULT_BRAND_COLORS) as (keyof BrandColors)[]) {
    const value = (input.colors[key] ?? '').trim();
    if (!HEX.test(value)) throw new BrandError((m) => m.color(m.fields[key]));
    colors[key] = value.toLowerCase();
  }
  const website = text(input.website, 'website');
  if (website && !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(website)) throw new BrandError((m) => m.website);
  const email = text(input.email, 'email');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BrandError((m) => m.email);

  let character: BrandCharacter | null = null;
  if (input.character) {
    const c = input.character;
    character = {
      name: text(c.name, 'name'),
      role: text(c.role, 'role'),
      look: text(c.look, 'look'),
      personality: text(c.personality, 'personality'),
      voice: text(c.voice, 'voice'),
      catchphrase: text(c.catchphrase, 'catchphrase'),
      rules: text(c.rules, 'rules'),
      imageMediaIds: [...new Set(c.imageMediaIds)],
    };
    if (!character.name) throw new BrandError((m) => m.characterName);
    if (character.imageMediaIds.length > MAX_CHARACTER_PICTURES) throw new BrandError((m) => m.tooManyPictures(MAX_CHARACTER_PICTURES));
  }
  return {
    companyName,
    tagline: text(input.tagline, 'tagline'),
    description: text(input.description, 'description'),
    audience: text(input.audience, 'audience'),
    tone: text(input.tone, 'tone'),
    dos: text(input.dos, 'dos'),
    donts: text(input.donts, 'donts'),
    colors,
    font: (BRAND_FONTS as readonly string[]).includes(input.font) ? input.font : 'sans',
    logoMediaId: input.logoMediaId || null,
    website,
    email,
    phone: text(input.phone, 'phone'),
    address: text(input.address, 'address'),
    character,
  };
}

/** Saves the workspace's brand kit; logo and character pictures must be the workspace's uploaded images. */
export async function saveBrandKit(db: Database, workspaceId: string, input: BrandKitInput): Promise<BrandKit> {
  const kit = cleanBrandKit(input);
  const mediaIds = [...new Set([kit.logoMediaId, ...(kit.character?.imageMediaIds ?? [])].filter((id): id is string => Boolean(id)))];
  const found = await findMedia(db, workspaceId, mediaIds);
  if (mediaIds.some((id) => found.get(id)?.kind !== 'image')) throw new BrandError((m) => m.notAnImage);
  const values = { ...kit, mediaIds, updatedAt: new Date() };
  const [row] = await db
    .insert(brandKits)
    .values({ workspaceId, ...values })
    .onConflictDoUpdate({ target: brandKits.workspaceId, set: values })
    .returning();
  return row!;
}

/**
 * The brand in a few plain lines (English labels), for briefings and AI
 * prompts: who the company is, how it sounds, and its character.
 */
export function brandBrief(kit: Pick<BrandKit, 'companyName' | 'tagline' | 'description' | 'audience' | 'tone' | 'dos' | 'donts' | 'website' | 'character'>): string {
  const lines = [`Company: ${kit.companyName}${kit.tagline ? ` — ${kit.tagline}` : ''}`];
  if (kit.description) lines.push(`What it does: ${kit.description}`);
  if (kit.audience) lines.push(`Audience: ${kit.audience}`);
  if (kit.tone) lines.push(`Tone of voice: ${kit.tone}`);
  if (kit.dos) lines.push(`Do: ${kit.dos}`);
  if (kit.donts) lines.push(`Don't: ${kit.donts}`);
  if (kit.website) lines.push(`Website: ${kit.website}`);
  const c = kit.character;
  if (c) {
    lines.push(`Brand character: ${c.name}${c.role ? `, ${c.role}` : ''}`);
    if (c.look) lines.push(`  Look: ${c.look}`);
    if (c.personality) lines.push(`  Personality: ${c.personality}`);
    if (c.voice) lines.push(`  Voice: ${c.voice}`);
    if (c.catchphrase) lines.push(`  Catchphrase: "${c.catchphrase}"`);
    if (c.rules) lines.push(`  Never: ${c.rules}`);
  }
  return lines.join('\n');
}
