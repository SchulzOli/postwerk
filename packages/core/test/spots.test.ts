import { eq, sql } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, media, postTargets, posts, users, workspaces, type Database } from '@maas/db';
import { runMigrations } from '../../db/src/migrate';
import { renderSpotBriefing } from '../src/briefing';
import { cleanSpotContent, createCampaign, createPiece, linkSpotVideo, saveSpotPiece, spotVideo } from '../src/campaigns';
import { errorText } from '../src/i18n';
import { checkSpot, emptyContent, spotTimecodes, timecode, youtubeVideoId, type SpotContent, type SpotScene } from '../src/marketing';
import { MediaError, postMediaFromUpload, sniffMediaType } from '../src/media';

const scene = (overrides: Partial<SpotScene> = {}): SpotScene => ({ seconds: 5, visual: 'Büro', voiceOver: 'Den ganzen Tag am Schreibtisch?', onScreenText: '', sound: '', character: false, ...overrides });
const rudi = { name: 'Rudi', catchphrase: 'Rücken? Rudi hilft!' };

describe('spot scripts', () => {
  it('times scenes', () => {
    expect(spotTimecodes([{ seconds: 4 }, { seconds: 8 }, { seconds: 3 }])).toEqual([
      { start: 0, end: 4 },
      { start: 4, end: 12 },
      { start: 12, end: 15 },
    ]);
    expect(timecode(75)).toBe('1:15');
    const fresh = emptyContent('spot', 'radio_20') as SpotContent;
    expect(fresh.scenes.reduce((sum, item) => sum + item.seconds, 0)).toBe(20);
  });

  it('says what a script still needs', () => {
    const content: SpotContent = { scenes: [scene({ seconds: 2, voiceOver: 'Den ganzen Tag am Schreibtisch und abends tut der Rücken weh?' }), scene({ seconds: 10 })], directions: '' };
    expect(checkSpot('video_15', content, rudi)).toEqual([
      { code: 'duration', total: 12, target: 15 },
      { code: 'tooFast', scene: 1, words: 11, max: 5 },
      { code: 'noCharacter', name: 'Rudi' },
      { code: 'noCatchphrase', name: 'Rudi', catchphrase: 'Rücken? Rudi hilft!' },
      { code: 'noFile' },
    ]);
    const done: SpotContent = { scenes: [scene({ seconds: 12 }), scene({ seconds: 3, voiceOver: 'Rücken – Rudi hilft.', character: true })], directions: '', fileMediaId: 'x' };
    expect(checkSpot('video_15', done, rudi)).toEqual([]);
    expect(checkSpot('video_15', done, null)).toEqual([]);
  });

  it('finds YouTube videos in links', () => {
    for (const link of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3', 'https://youtu.be/dQw4w9WgXcQ', 'https://youtube.com/shorts/dQw4w9WgXcQ', 'https://m.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ']) {
      expect(youtubeVideoId(link)).toBe('dQw4w9WgXcQ');
    }
    expect(youtubeVideoId('https://vimeo.com/123')).toBeNull();
    expect(youtubeVideoId('not a link')).toBeNull();
  });

  it('keeps only what radio can carry and says what to fix', () => {
    const radio = cleanSpotContent('radio_30', { scenes: [scene({ visual: 'Büro', onScreenText: '3 Übungen', seconds: 30 })], directions: ' ruhig ', youtubeVideoId: 'https://youtu.be/dQw4w9WgXcQ' });
    expect(radio).toEqual({ scenes: [{ seconds: 30, visual: '', voiceOver: 'Den ganzen Tag am Schreibtisch?', onScreenText: '', sound: '', character: false }], directions: 'ruhig' });
    expect(cleanSpotContent('video_6', { scenes: [scene({ seconds: 6 })], directions: '', youtubeVideoId: 'https://youtu.be/dQw4w9WgXcQ' }).youtubeVideoId).toBe('dQw4w9WgXcQ');
    const fail = (content: SpotContent) => {
      try {
        cleanSpotContent('video_15', content);
      } catch (error) {
        return errorText(error, 'en');
      }
      return 'no error';
    };
    expect(fail({ scenes: [], directions: '' })).toMatch(/between 1 and 20 scenes/);
    expect(fail({ scenes: [scene({ seconds: 0 })], directions: '' })).toMatch(/whole seconds/);
    expect(fail({ scenes: [scene()], directions: '', youtubeVideoId: 'https://vimeo.com/1' })).toMatch(/not a YouTube link/);
  });

  it('writes a briefing with the script on as many pages as it needs', async () => {
    const kit = {
      companyName: 'Praxis Ruhige Nähe',
      tagline: 'Bewegung, die gut tut',
      tone: 'ruhig, warm',
      dos: 'konkrete Übungen',
      donts: 'Heilversprechen',
      colors: { primary: '#0d9488', secondary: '#134e4a', accent: '#f59e0b', text: '#1f2937', background: '#f8fafc' },
      font: 'serif',
      audience: 'Menschen mit Rückenschmerzen',
      character: { name: 'Rudi', role: 'ein Rückenwirbel', look: 'beige, grünes Stirnband', personality: 'geduldig', voice: 'warm', catchphrase: 'Rücken? Rudi hilft!', rules: 'nie belehrend', imageMediaIds: [] },
    };
    const brief = (scenes: SpotScene[]) =>
      renderSpotBriefing({ title: 'Videospot', format: 'video_30', formatName: 'Video spot, 30 s', campaign: { name: 'Rückenwochen', message: 'Rudi hilft', audience: '' }, content: { scenes, directions: 'Ruhiges Tempo.' }, kit, images: {} }, 'de');
    const short = await PDFDocument.load(await brief([scene({ seconds: 30, character: true })]));
    expect(short.getPageCount()).toBe(1);
    expect(short.getTitle()).toBe('Spot-Briefing: Videospot');
    const long = await PDFDocument.load(await brief(Array.from({ length: 20 }, () => scene({ seconds: 1, visual: 'Eine lange Beschreibung dessen, was man sieht. '.repeat(4), voiceOver: 'Was gesagt wird. '.repeat(6) }))));
    expect(long.getPageCount()).toBeGreaterThan(1);
  });
});

describe('audio uploads', () => {
  const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));
  it('recognizes MP3, M4A and WAV', () => {
    expect(sniffMediaType(new Uint8Array([...ascii('ID3'), 4, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('audio/mpeg');
    expect(sniffMediaType(new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('audio/mpeg');
    expect(sniffMediaType(new Uint8Array([0, 0, 0, 32, ...ascii('ftypM4A ')]))).toBe('audio/mp4');
    expect(sniffMediaType(new Uint8Array([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')]))).toBe('audio/wav');
  });

  it('keeps audio out of posts', () => {
    expect(() => postMediaFromUpload({ id: 'a', workspaceId: 'w', key: 'w/a.mp3', kind: 'audio', mimeType: 'audio/mpeg', size: 1, uploadedBy: null, createdAt: new Date() })).toThrow(MediaError);
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('spots (Postgres)', () => {
  let db: Database;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    await runMigrations(url);
    db = createDb(url);
  });
  afterAll(async () => db?.close());
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE workspaces, users CASCADE`);
    const [user] = await db.insert(users).values({ email: 'a@example.com', name: 'A', passwordHash: 'x' }).returning();
    const [workspace] = await db.insert(workspaces).values({ name: 'Praxis' }).returning();
    userId = user!.id;
    workspaceId = workspace!.id;
  });

  const campaign = () =>
    createCampaign(db, workspaceId, userId, { name: 'Rückenwochen', goal: 'awareness', status: 'running', audience: '', message: '', startsOn: null, endsOn: null, currency: 'EUR', budgetCents: 0, channels: [], notes: '' });
  const upload = async (kind: 'video' | 'audio') =>
    (await db.insert(media).values({ workspaceId, key: `${workspaceId}/${crypto.randomUUID()}.${kind === 'video' ? 'mp4' : 'mp3'}`, kind, mimeType: kind === 'video' ? 'video/mp4' : 'audio/mpeg', size: 10 }).returning())[0]!;

  it('takes the produced file of the right kind', async () => {
    const { id: campaignId } = await campaign();
    const radio = await createPiece(db, workspaceId, campaignId, { kind: 'spot', format: 'radio_20', title: 'Radiospot' });
    const [video, sound] = [await upload('video'), await upload('audio')];
    const content = { scenes: [scene({ seconds: 20 })], directions: '' };
    await expect(saveSpotPiece(db, workspaceId, radio.id, { title: 'Radiospot', content: { ...content, fileMediaId: video.id } })).rejects.toThrow(/audio upload/);
    const saved = await saveSpotPiece(db, workspaceId, radio.id, { title: 'Radiospot', content: { ...content, fileMediaId: sound.id } });
    expect(saved.mediaIds).toEqual([sound.id]);
  });

  it('follows the YouTube upload until the video is there', async () => {
    const { id: campaignId } = await campaign();
    const spot = await createPiece(db, workspaceId, campaignId, { kind: 'spot', format: 'video_15', title: 'Videospot' });
    const [post] = await db.insert(posts).values({ workspaceId, text: 'Spot', status: 'publishing', campaignId }).returning();
    await linkSpotVideo(db, workspaceId, spot.id, { youtubePostId: post!.id });
    const content = async () => ((await db.query.pieces.findFirst({ where: (p, { eq: equals }) => equals(p.id, spot.id) }))!.content as unknown as SpotContent);
    expect(await spotVideo(db, workspaceId, await content())).toEqual({ videoId: null, post: { id: post!.id, status: 'publishing', url: null, error: null } });

    const account = (await db.execute<{ id: string }>(sql`INSERT INTO social_accounts (workspace_id, provider, external_id, handle, credentials_enc) VALUES (${workspaceId}, 'youtube', 'c1', '@praxis', 'x') RETURNING id`))[0]!;
    await db.insert(postTargets).values({ postId: post!.id, socialAccountId: account.id, status: 'published', remoteUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', nextAttemptAt: new Date() });
    await db.update(posts).set({ status: 'published' }).where(eq(posts.id, post!.id));
    expect((await spotVideo(db, workspaceId, await content())).videoId).toBe('dQw4w9WgXcQ');
  });
});
