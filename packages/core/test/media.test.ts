import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, media, posts, users, workspaces, type Database } from '@postwerk/db';
import { runMigrations } from '../../db/src/migrate';
import { cleanupUnusedMedia, mediaForPublishing, MediaError, postMediaFromUpload, sniffMediaType, storeUpload } from '../src/media';
import { isMediaKey, localStorage, s3Storage, type MediaStorage } from '../src/storage';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4]);
const MP4 = new Uint8Array([0, 0, 0, 24, ...[...'ftypisom'].map((c) => c.charCodeAt(0)), 0, 0, 0, 0]);
const WS = '11111111-1111-4111-8111-111111111111';
const KEY = `${WS}/22222222-2222-4222-8222-222222222222.png`;

/** A body delivered in small chunks, like a real upload. */
function streamOf(bytes: Uint8Array, chunk = 5): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + chunk));
      offset += chunk;
    },
  });
}

const text = (body: ReadableStream<Uint8Array>) => new Response(body).arrayBuffer().then((buffer) => new Uint8Array(buffer));

describe('media files', () => {
  it('recognizes files by their first bytes', () => {
    expect(sniffMediaType(PNG)).toBe('image/png');
    expect(sniffMediaType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMediaType(new TextEncoder().encode('GIF89a......'))).toBe('image/gif');
    expect(sniffMediaType(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffMediaType(MP4)).toBe('video/mp4');
    expect(sniffMediaType(new Uint8Array([0, 0, 0, 20, ...[...'ftypqt  '].map((c) => c.charCodeAt(0))]))).toBe('video/quicktime');
    expect(sniffMediaType(new TextEncoder().encode('<svg onload="alert(1)">'))).toBeUndefined();
  });

  it('only accepts generated keys', () => {
    expect(isMediaKey(KEY)).toBe(true);
    for (const bad of ['../etc/passwd', `${WS}/../../x.png`, `${WS}/22222222-2222-4222-8222-222222222222.svg`, 'a/b.png']) expect(isMediaKey(bad)).toBe(false);
  });
});

describe('local storage', () => {
  let dir: string;
  let storage: MediaStorage;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'postwerk-media-'));
    storage = localStorage(dir, 'https://app.test');
  });
  afterEach(async () => rm(dir, { recursive: true, force: true }));

  it('stores, reads ranges, serves a public URL and deletes', async () => {
    await storage.put(KEY, streamOf(PNG), { contentType: 'image/png', size: PNG.length });
    expect(new Uint8Array(await readFile(join(dir, KEY)))).toEqual(PNG);
    const whole = await storage.get(KEY);
    expect(whole?.size).toBe(16);
    expect(await text(whole!.body)).toEqual(PNG);
    const part = await storage.get(KEY, { start: 1, end: 3 });
    expect(part?.range).toEqual({ start: 1, end: 3 });
    expect(await text(part!.body)).toEqual(PNG.slice(1, 4));
    expect(await storage.publicUrl(KEY)).toBe(`https://app.test/media/${KEY}`);
    await storage.delete(KEY);
    expect(await storage.get(KEY)).toBeUndefined();
  });

  it('refuses keys outside its directory', async () => {
    await expect(storage.get('../../etc/passwd')).rejects.toThrow(/Invalid media key/);
  });

  it('never leaves a half-written file behind', async () => {
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(PNG.slice(0, 4));
        controller.error(new Error('connection lost'));
      },
    });
    await expect(storage.put(KEY, failing, { contentType: 'image/png', size: 16 })).rejects.toThrow();
    await expect(stat(join(dir, KEY))).rejects.toThrow();
    await expect(stat(join(dir, `${KEY}.partial`))).rejects.toThrow();
  });
});

describe('S3 storage (fake server)', () => {
  let server: Server;
  let endpoint: string;
  const objects = new Map<string, Buffer>();
  const seen: { method: string; url: string; authorization?: string }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push({ method: req.method!, url: req.url!, authorization: req.headers.authorization });
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const object = objects.get(req.url!);
        if (req.method === 'PUT') objects.set(req.url!, Buffer.concat(chunks));
        else if (req.method === 'DELETE') objects.delete(req.url!);
        else if (!object) return res.writeHead(404).end();
        else if (req.headers.range) {
          const [, start, end] = /bytes=(\d+)-(\d+)/.exec(req.headers.range)!;
          return res.writeHead(206, { 'content-range': `bytes ${start}-${end}/${object.length}` }).end(object.subarray(Number(start), Number(end) + 1));
        } else return res.writeHead(200, { 'content-length': object.length }).end(object);
        res.writeHead(204).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('uploads with a signed request, reads ranges and presigns links', async () => {
    const storage = s3Storage({ endpoint, bucket: 'media', region: 'eu-central-1', accessKeyId: 'AKID', secretAccessKey: 'secret', pathStyle: true });
    await storage.put(KEY, streamOf(PNG), { contentType: 'image/png', size: PNG.length });
    expect(seen.at(-1)).toMatchObject({ method: 'PUT', url: `/media/${KEY}` });
    expect(seen.at(-1)!.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID\/\d{8}\/eu-central-1\/s3\/aws4_request/);
    expect(objects.get(`/media/${KEY}`)).toEqual(Buffer.from(PNG));

    const part = await storage.get(KEY, { start: 2, end: 5 });
    expect(part).toMatchObject({ size: 16, range: { start: 2, end: 5 } });
    expect(await text(part!.body)).toEqual(PNG.slice(2, 6));

    const url = await storage.publicUrl(KEY);
    expect(url).toContain(`${endpoint}/media/${KEY}?X-Amz-Algorithm=AWS4-HMAC-SHA256`);
    expect(url).toContain('X-Amz-Expires=86400');
    await storage.delete(KEY);
    expect(await storage.get(KEY)).toBeUndefined();
  });

  it('uses the public base URL when the bucket is public', async () => {
    const storage = s3Storage({ endpoint, bucket: 'media', region: 'x', accessKeyId: 'a', secretAccessKey: 'b', pathStyle: false, publicBaseUrl: 'https://cdn.test/' });
    expect(await storage.publicUrl(KEY)).toBe(`https://cdn.test/${KEY}`);
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('uploads (Postgres)', () => {
  let db: Database;
  let dir: string;
  let storage: MediaStorage;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    await runMigrations(url);
    db = createDb(url);
  });
  afterAll(async () => db?.close());

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'postwerk-media-'));
    storage = localStorage(dir, 'https://app.test');
    await db.execute(sql`TRUNCATE users, workspaces CASCADE`);
    const [user] = await db.insert(users).values({ email: 'a@example.com', name: 'A', passwordHash: 'x' }).returning();
    const [workspace] = await db.insert(workspaces).values({ name: 'W' }).returning();
    userId = user!.id;
    workspaceId = workspace!.id;
  });
  afterEach(async () => rm(dir, { recursive: true, force: true }));

  const upload = (bytes: Uint8Array, contentType: string, size = bytes.length) => storeUpload(db, { workspaceId, userId, contentType, size, body: streamOf(bytes) }, storage);

  it('stores real images and videos', async () => {
    const image = await upload(PNG, 'image/png');
    expect(image).toMatchObject({ workspaceId, kind: 'image', mimeType: 'image/png', size: 16 });
    expect(image.key).toMatch(new RegExp(`^${workspaceId}/[0-9a-f-]{36}\\.png$`));
    expect(await storage.get(image.key)).toBeDefined();
    expect((await upload(MP4, 'video/mp4')).kind).toBe('video');
  });

  it('refuses what is not a supported image or video, and cleans up', async () => {
    await expect(upload(new TextEncoder().encode('<html><script>alert(1)</script></html>'), 'image/png')).rejects.toThrow(MediaError);
    await expect(upload(PNG, 'image/svg+xml')).rejects.toThrow(/JPEG, PNG/);
    await expect(upload(MP4, 'image/png')).rejects.toThrow(/not a supported/);
    await expect(upload(PNG, 'image/png', 64 * 1024 * 1024)).rejects.toThrow(/up to 20 MB/);
    await expect(upload(PNG, 'image/png', 10)).rejects.toThrow(/larger than announced/);
    await expect(upload(PNG, 'image/png', 20)).rejects.toThrow(/interrupted/);
    expect(await db.select().from(media)).toHaveLength(0);
  });

  it('gives networks fetchable URLs and the bytes for uploads', async () => {
    const image = await upload(PNG, 'image/png');
    const { media: items, loadMedia } = await mediaForPublishing([postMediaFromUpload(image, 'A chart'), { url: 'https://example.com/x.jpg', kind: 'image' }], storage);
    expect(items[0]).toMatchObject({ url: `https://app.test/media/${image.key}`, kind: 'image', altText: 'A chart', mimeType: 'image/png', size: 16 });
    expect(items[1]).toMatchObject({ url: 'https://example.com/x.jpg' });
    const loaded = await loadMedia(items[0]!);
    expect(new Uint8Array(await loaded!.blob.arrayBuffer())).toEqual(PNG);
    expect(await loadMedia(items[1]!)).toBeUndefined();
  });

  it('removes old uploads that no post uses', async () => {
    const used = await upload(PNG, 'image/png');
    const unused = await upload(PNG, 'image/png');
    const fresh = await upload(PNG, 'image/png');
    await db.execute(sql`UPDATE media SET created_at = now() - interval '2 days' WHERE id IN (${used.id}, ${unused.id})`);
    await db.insert(posts).values({ workspaceId, text: 'x', media: [postMediaFromUpload(used)] });

    expect(await cleanupUnusedMedia(db, storage)).toBe(1);
    expect((await db.select().from(media)).map((row) => row.id).sort()).toEqual([used.id, fresh.id].sort());
    expect(await storage.get(unused.key)).toBeUndefined();
    expect(await storage.get(used.key)).toBeDefined();
  });
});
