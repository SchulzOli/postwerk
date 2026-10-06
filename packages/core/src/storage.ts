import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { presignUrl, signRequest, type SigV4Credentials } from './sigv4';

/** The only file types Postwerk accepts and serves (no SVG or HTML, so uploads can never run script). */
export const mediaTypes = {
  'image/jpeg': { kind: 'image', ext: 'jpg' },
  'image/png': { kind: 'image', ext: 'png' },
  'image/gif': { kind: 'image', ext: 'gif' },
  'image/webp': { kind: 'image', ext: 'webp' },
  'video/mp4': { kind: 'video', ext: 'mp4' },
  'video/quicktime': { kind: 'video', ext: 'mov' },
  'video/webm': { kind: 'video', ext: 'webm' },
} as const;

export type MediaType = keyof typeof mediaTypes;

const KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|gif|webp|mp4|mov|webm)$/;

/** Storage keys look like "<workspace id>/<uuid>.<ext>"; anything else is refused. */
export function isMediaKey(key: string): boolean {
  return KEY.test(key);
}

export function contentTypeOfKey(key: string): MediaType {
  const ext = key.split('.').pop();
  return (Object.entries(mediaTypes).find(([, type]) => type.ext === ext)?.[0] ?? 'application/octet-stream') as MediaType;
}

export interface StoredFile {
  body: ReadableStream<Uint8Array>;
  /** Total size of the file. */
  size: number;
  /** The requested byte range, if any (inclusive). */
  range?: { start: number; end: number };
}

export interface MediaStorage {
  /** Stores a file; the body is consumed. */
  put(key: string, body: ReadableStream<Uint8Array>, info: { contentType: string; size: number }): Promise<void>;
  get(key: string, range?: { start: number; end?: number }): Promise<StoredFile | undefined>;
  delete(key: string): Promise<void>;
  /** A URL a social network can fetch the file from right now. */
  publicUrl(key: string): Promise<string>;
  /** Where the app's /media route should send browsers instead of streaming the file itself. */
  redirectUrl?(key: string): Promise<string>;
}

// ---------------------------------------------------------------- local disk

/** Files in a directory, served by the web app at /media/<key>. Web and worker must share the directory. */
export function localStorage(directory: string, appUrl: string): MediaStorage {
  const root = resolve(directory);
  const pathOf = (key: string) => {
    if (!isMediaKey(key)) throw new Error('Invalid media key');
    const path = resolve(root, key);
    if (!path.startsWith(root + sep)) throw new Error('Invalid media key');
    return path;
  };
  return {
    async put(key, body) {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      // Write to a temporary name first so a half-written file is never served.
      const partial = `${path}.partial`;
      try {
        await pipeline(Readable.fromWeb(body as WebReadableStream<Uint8Array>), createWriteStream(partial));
        await rename(partial, path);
      } catch (error) {
        await rm(partial, { force: true });
        throw error;
      }
    },
    async get(key, range) {
      const path = pathOf(key);
      const info = await stat(path).catch(() => undefined);
      if (!info?.isFile()) return undefined;
      const start = range ? Math.min(range.start, info.size) : 0;
      const end = range ? Math.min(range.end ?? info.size - 1, info.size - 1) : info.size - 1;
      const stream = info.size === 0 || start > end ? Readable.from([]) : createReadStream(path, { start, end });
      return { body: Readable.toWeb(stream) as ReadableStream<Uint8Array>, size: info.size, ...(range && { range: { start, end } }) };
    },
    async delete(key) {
      await rm(pathOf(key), { force: true });
    },
    async publicUrl(key) {
      return `${appUrl}/media/${key}`;
    },
  };
}

// ---------------------------------------------------------------- S3

export interface S3Config extends SigV4Credentials {
  /** e.g. https://s3.eu-central-1.amazonaws.com or https://minio.example.com */
  endpoint: string;
  bucket: string;
  /** Path-style URLs (endpoint/bucket/key), needed by MinIO and most self-hosted S3. */
  pathStyle: boolean;
  /** If the bucket is public (or behind a CDN): its base URL. Otherwise files are shared with presigned URLs. */
  publicBaseUrl?: string;
}

/** How long presigned URLs given to networks and browsers stay valid. */
const PRESIGN_SECONDS = 24 * 3600;

export function s3Storage(config: S3Config): MediaStorage {
  const endpoint = new URL(config.endpoint);
  const objectUrl = (key: string) =>
    config.pathStyle ? `${endpoint.origin}/${config.bucket}/${key}` : `${endpoint.protocol}//${config.bucket}.${endpoint.host}/${key}`;

  async function send(method: string, key: string, init: { headers?: Record<string, string>; body?: ReadableStream<Uint8Array> } = {}) {
    const url = objectUrl(key);
    const headers = signRequest({ method, url, headers: init.headers }, config);
    return fetch(url, { method, headers, body: init.body, ...(init.body && { duplex: 'half' }) } as RequestInit);
  }

  async function failed(response: Response, what: string): Promise<never> {
    const body = await response.text().catch(() => '');
    throw new Error(`S3 ${what} failed (${response.status}): ${body.slice(0, 200)}`);
  }

  async function publicUrl(key: string) {
    if (config.publicBaseUrl) return `${config.publicBaseUrl.replace(/\/$/, '')}/${key}`;
    return presignUrl({ url: objectUrl(key), expiresIn: PRESIGN_SECONDS }, config);
  }

  return {
    async put(key, body, info) {
      const response = await send('PUT', key, { headers: { 'content-type': info.contentType, 'content-length': String(info.size) }, body });
      if (!response.ok) await failed(response, 'upload');
    },
    async get(key, range) {
      const headers: Record<string, string> = range ? { range: `bytes=${range.start}-${range.end ?? ''}` } : {};
      const response = await send('GET', key, { headers });
      if (response.status === 404) return undefined;
      if (!response.ok || !response.body) await failed(response, 'download');
      const contentRange = response.headers.get('content-range')?.match(/bytes (\d+)-(\d+)\/(\d+)/);
      if (contentRange) {
        return { body: response.body!, size: Number(contentRange[3]), range: { start: Number(contentRange[1]), end: Number(contentRange[2]) } };
      }
      return { body: response.body!, size: Number(response.headers.get('content-length') ?? 0) };
    },
    async delete(key) {
      const response = await send('DELETE', key);
      if (!response.ok && response.status !== 404) await failed(response, 'delete');
    },
    publicUrl,
    redirectUrl: publicUrl,
  };
}

// ---------------------------------------------------------------- configuration

type Env = Record<string, string | undefined>;

/**
 * MEDIA_STORAGE=local (default; MEDIA_DIR, default "data/media") or s3
 * (S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,
 * optional S3_FORCE_PATH_STYLE and S3_PUBLIC_URL).
 */
export function storageFromEnv(env: Env = process.env): MediaStorage {
  const appUrl = (env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  if ((env.MEDIA_STORAGE ?? 'local') !== 's3') return localStorage(env.MEDIA_DIR?.trim() || 'data/media', appUrl);
  const required = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const;
  const missing = required.filter((name) => !env[name]?.trim());
  if (missing.length > 0) throw new Error(`MEDIA_STORAGE=s3 needs ${missing.join(', ')}.`);
  return s3Storage({
    endpoint: env.S3_ENDPOINT!.trim(),
    region: env.S3_REGION?.trim() || 'us-east-1',
    bucket: env.S3_BUCKET!.trim(),
    accessKeyId: env.S3_ACCESS_KEY_ID!.trim(),
    secretAccessKey: env.S3_SECRET_ACCESS_KEY!.trim(),
    pathStyle: env.S3_FORCE_PATH_STYLE === 'true',
    publicBaseUrl: env.S3_PUBLIC_URL?.trim() || undefined,
  });
}

let storage: MediaStorage | undefined;

/** The configured storage (one per process). */
export function getMediaStorage(): MediaStorage {
  storage ??= storageFromEnv();
  return storage;
}

/** Replaces the storage (tests, custom setups); `undefined` goes back to the environment's. */
export function setMediaStorage(next: MediaStorage | undefined): void {
  storage = next;
}
