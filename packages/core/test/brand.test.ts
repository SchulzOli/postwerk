import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, media, workspaces, type Database } from '@maas/db';
import { runMigrations } from '../../db/src/migrate';
import { brandBrief, cleanBrandKit, DEFAULT_BRAND_COLORS, getBrandKit, saveBrandKit, type BrandKitInput } from '../src/brand';
import { errorText } from '../src/i18n';
import { cleanupUnusedMedia } from '../src/media';

const input = (overrides: Partial<BrandKitInput> = {}): BrandKitInput => ({
  companyName: 'Praxis Ruhige Nähe',
  tagline: 'Bewegung, die gut tut',
  description: 'Physiotherapie in Berlin',
  audience: 'Menschen mit Rückenschmerzen',
  tone: 'ruhig, warm, kompetent; du',
  dos: 'konkrete Übungen',
  donts: 'Heilversprechen',
  colors: { ...DEFAULT_BRAND_COLORS, primary: '#0D9488' },
  font: 'serif',
  logoMediaId: null,
  website: 'https://praxis.example',
  email: 'hallo@praxis.example',
  phone: '+49 30 123',
  address: 'Hauptstraße 1, Berlin',
  character: {
    name: 'Rudi',
    role: 'ein freundlicher Rückenwirbel',
    look: 'kleiner beiger Wirbel mit großen Augen und grünem Stirnband',
    personality: 'geduldig, motivierend',
    voice: 'kurze Sätze, duzt',
    catchphrase: 'Rücken? Rudi hilft!',
    rules: 'nie belehrend',
    imageMediaIds: [],
  },
  ...overrides,
});

describe('brand kit checks', () => {
  it('cleans texts and colors', () => {
    const kit = cleanBrandKit(input({ companyName: '  Praxis  ', font: 'comic' }));
    expect(kit.companyName).toBe('Praxis');
    expect(kit.colors.primary).toBe('#0d9488');
    expect(kit.font).toBe('sans');
  });

  it('says what to fix, in the person’s language', () => {
    const fail = (overrides: Partial<BrandKitInput>) => {
      try {
        cleanBrandKit(input(overrides));
      } catch (error) {
        return [errorText(error, 'en'), errorText(error, 'de')];
      }
      throw new Error('expected an error');
    };
    expect(fail({ companyName: ' ' })[0]).toBe('Please enter the company name.');
    expect(fail({ colors: { ...DEFAULT_BRAND_COLORS, accent: 'orange' } })).toEqual(['Accent color must be a color like #3b5bdb.', 'Akzentfarbe muss eine Farbe wie #3b5bdb sein.']);
    expect(fail({ website: 'praxis.example' })[0]).toMatch(/https:\/\//);
    expect(fail({ tagline: 'x'.repeat(161) })[1]).toBe('Slogan ist länger als 160 Zeichen.');
    expect(fail({ character: { ...input().character!, name: '' } })[0]).toMatch(/character a name/);
  });

  it('sums the brand up for briefings', () => {
    const brief = brandBrief({ ...cleanBrandKit(input()) });
    expect(brief).toContain('Company: Praxis Ruhige Nähe — Bewegung, die gut tut');
    expect(brief).toContain('Brand character: Rudi, ein freundlicher Rückenwirbel');
    expect(brief).toContain('Catchphrase: "Rücken? Rudi hilft!"');
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('brand kit storage (Postgres)', () => {
  let db: Database;
  let workspaceId: string;

  beforeAll(async () => {
    await runMigrations(url);
    db = createDb(url);
  });
  afterAll(async () => db?.close());
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE workspaces, users CASCADE`);
    const [row] = await db.insert(workspaces).values({ name: 'Praxis' }).returning();
    workspaceId = row!.id;
  });

  const upload = async (kind: 'image' | 'video' = 'image') => {
    const [row] = await db
      .insert(media)
      .values({ workspaceId, key: `${workspaceId}/${crypto.randomUUID()}.png`, kind, mimeType: kind === 'image' ? 'image/png' : 'video/mp4', size: 10, createdAt: new Date(Date.now() - 2 * 86_400_000) })
      .returning();
    return row!;
  };

  it('starts from the workspace name and saves the kit with its pictures', async () => {
    expect(await getBrandKit(db, { id: workspaceId, name: 'Praxis' })).toMatchObject({ companyName: 'Praxis', character: null, colors: DEFAULT_BRAND_COLORS });
    const [logo, rudi] = [await upload(), await upload()];
    await saveBrandKit(db, workspaceId, input({ logoMediaId: logo.id, character: { ...input().character!, imageMediaIds: [rudi.id] } }));
    const kit = await getBrandKit(db, { id: workspaceId, name: 'Praxis' });
    expect(kit).toMatchObject({ companyName: 'Praxis Ruhige Nähe', logoMediaId: logo.id, character: { name: 'Rudi', imageMediaIds: [rudi.id] } });
    expect(kit.mediaIds.sort()).toEqual([logo.id, rudi.id].sort());

    // Saving again updates the same kit.
    await saveBrandKit(db, workspaceId, input({ tagline: 'Neu', logoMediaId: logo.id, character: null }));
    expect(await getBrandKit(db, { id: workspaceId, name: 'Praxis' })).toMatchObject({ tagline: 'Neu', character: null, mediaIds: [logo.id] });
  });

  it('only takes the workspace’s own uploaded images', async () => {
    const video = await upload('video');
    await expect(saveBrandKit(db, workspaceId, input({ logoMediaId: video.id }))).rejects.toThrow(/uploaded images/);
    await expect(saveBrandKit(db, workspaceId, input({ logoMediaId: crypto.randomUUID() }))).rejects.toThrow(/uploaded images/);
  });

  it('keeps the brand’s pictures when unused uploads are cleaned up', async () => {
    const [logo, stray] = [await upload(), await upload()];
    await saveBrandKit(db, workspaceId, input({ logoMediaId: logo.id }));
    const deleted: string[] = [];
    await cleanupUnusedMedia(db, { delete: async (key: string) => void deleted.push(key) } as never);
    expect(deleted).toEqual([stray.key]);
  });
});
