import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { media, type Database, type Media, type PostMedia } from '@postwerk/db';
import { formatBytes, type MediaItem, type PublishContext } from '@postwerk/providers';
import { getMediaStorage, mediaTypes, type MediaStorage, type MediaType } from './storage';
import { LocalizedError } from './i18n';
import { mediaMessages } from './messages';

/** Something is wrong with an upload; the message is meant for the user. */
export class MediaError extends LocalizedError {
  constructor(pick: (m: (typeof mediaMessages)['en']) => string) {
    super((locale) => pick(mediaMessages[locale]));
  }
}

type Env = Record<string, string | undefined>;

/** Largest files Postwerk stores; networks may accept less (see the catalog). */
export function uploadLimits(env: Env = process.env) {
  return { image: 20 * 1024 * 1024, video: Number(env.MEDIA_MAX_VIDEO_MB || 512) * 1024 * 1024 };
}

const startsWith = (bytes: Uint8Array, prefix: number[], offset = 0) => prefix.every((byte, index) => bytes[offset + index] === byte);
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

/** Recognizes a file from its first bytes (needs about 12), whatever its name claims. */
export function sniffMediaType(head: Uint8Array): MediaType | undefined {
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(head, ascii('GIF87a')) || startsWith(head, ascii('GIF89a'))) return 'image/gif';
  if (startsWith(head, ascii('RIFF')) && startsWith(head, ascii('WEBP'), 8)) return 'image/webp';
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';
  if (startsWith(head, ascii('ftyp'), 4)) return startsWith(head, ascii('qt  '), 8) ? 'video/quicktime' : 'video/mp4';
  return undefined;
}

const SNIFF_BYTES = 12;

/**
 * Passes the upload through while checking that it really is the declared
 * kind of file and exactly `size` bytes long.
 */
function checkedUpload(body: ReadableStream<Uint8Array>, kind: 'image' | 'video', size: number): ReadableStream<Uint8Array> {
  let received = 0;
  let head = new Uint8Array(0);
  let sniffed = false;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > size) throw new MediaError((m) => m.largerThanAnnounced);
        if (!sniffed) {
          head = new Uint8Array([...head, ...chunk.subarray(0, SNIFF_BYTES)]);
          if (head.length >= SNIFF_BYTES || received === size) {
            const type = sniffMediaType(head);
            if (!type || mediaTypes[type].kind !== kind) throw new MediaError((m) => m.notMedia);
            sniffed = true;
          }
        }
        controller.enqueue(chunk);
      },
      flush() {
        if (received !== size) throw new MediaError((m) => m.interrupted);
      },
    }),
  );
}

/** Stores an upload (checked as it streams) and records it for the workspace. */
export async function storeUpload(
  db: Database,
  input: { workspaceId: string; userId: string; contentType: string; size: number; body: ReadableStream<Uint8Array> },
  storage: MediaStorage = getMediaStorage(),
): Promise<Media> {
  const contentType = input.contentType.split(';')[0]!.trim().toLowerCase();
  const type = mediaTypes[contentType as MediaType];
  if (!type) throw new MediaError((m) => m.unsupportedType);
  if (!Number.isInteger(input.size) || input.size <= 0) throw new MediaError((m) => m.empty);
  const limit = uploadLimits()[type.kind];
  if (input.size > limit) throw new MediaError((m) => m.tooLarge({ kind: type.kind, limit: formatBytes(limit) }));

  const key = `${input.workspaceId}/${randomUUID()}.${type.ext}`;
  try {
    await storage.put(key, checkedUpload(input.body, type.kind, input.size), { contentType, size: input.size });
  } catch (error) {
    await storage.delete(key).catch(() => undefined);
    if (error instanceof MediaError) throw error;
    // pipeTo/pipeline wrap the error from the check; find it again.
    if ((error as { cause?: unknown }).cause instanceof MediaError) throw (error as { cause: MediaError }).cause;
    throw error;
  }
  const [row] = await db
    .insert(media)
    .values({ workspaceId: input.workspaceId, key, kind: type.kind, mimeType: contentType, size: input.size, uploadedBy: input.userId })
    .returning();
  return row!;
}

/** Uploads of a workspace by id (others' ids are ignored), keyed by id. */
export async function findMedia(db: Database, workspaceId: string, ids: string[]): Promise<Map<string, Media>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select().from(media).where(and(eq(media.workspaceId, workspaceId), inArray(media.id, ids)));
  return new Map(rows.map((row) => [row.id, row]));
}

export function postMediaFromUpload(row: Media, altText?: string): PostMedia {
  return { url: `/media/${row.key}`, kind: row.kind, mediaId: row.id, key: row.key, mimeType: row.mimeType, size: row.size, ...(altText && { altText }) };
}

/**
 * What a provider gets for a post's media: uploads get a URL the network can
 * fetch (presigned for private S3), and `loadMedia` reads them from storage
 * directly for networks we upload bytes to.
 */
export async function mediaForPublishing(
  items: PostMedia[],
  storage: MediaStorage = getMediaStorage(),
): Promise<{ media: MediaItem[]; loadMedia: NonNullable<PublishContext['loadMedia']> }> {
  const keys = new Map<string, string>();
  const resolved: MediaItem[] = [];
  for (const item of items) {
    const base = { kind: item.kind, altText: item.altText, mimeType: item.mimeType, size: item.size };
    if (!item.key) {
      resolved.push({ ...base, url: item.url });
      continue;
    }
    const url = await storage.publicUrl(item.key);
    keys.set(url, item.key);
    resolved.push({ ...base, url });
  }
  return {
    media: resolved,
    async loadMedia(item) {
      const key = keys.get(item.url);
      if (!key) return undefined;
      const file = await storage.get(key);
      if (!file) return undefined;
      const blob = await new Response(file.body).blob();
      return { blob, mimeType: item.mimeType ?? 'application/octet-stream' };
    },
  };
}

/** Deletes uploads that no post uses and that are older than `olderThanMs` (default one day). */
export async function cleanupUnusedMedia(db: Database, storage: MediaStorage = getMediaStorage(), olderThanMs = 24 * 60 * 60_000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const deleted = await db.execute<{ key: string }>(sql`
    DELETE FROM ${media} m
    WHERE m.created_at < ${cutoff}::timestamptz
      AND NOT EXISTS (
        SELECT 1 FROM posts p WHERE p.media @> jsonb_build_array(jsonb_build_object('mediaId', m.id::text))
      )
    RETURNING m.key
  `);
  for (const { key } of deleted) await storage.delete(key).catch((error: unknown) => console.error('could not delete media file', key, error));
  return deleted.length;
}
