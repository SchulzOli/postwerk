import { createHash, createHmac } from 'node:crypto';

/**
 * AWS Signature Version 4 for S3-compatible storage (AWS, MinIO, R2,
 * Backblaze, Hetzner…), enough for PUT/GET/DELETE and presigned GET URLs.
 */
export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
}

export const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';
export const EMPTY_PAYLOAD_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const sha256Hex = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const hmac = (key: string | Buffer, value: string) => createHmac('sha256', key).update(value).digest();

/** RFC 3986 encoding as S3 expects it (only A–Z a–z 0–9 - . _ ~ stay as they are). */
export function uriEncode(value: string, keepSlash = false): string {
  return [...new TextEncoder().encode(value)]
    .map((byte) => {
      const char = String.fromCharCode(byte);
      if (/[A-Za-z0-9\-._~]/.test(char) || (keepSlash && char === '/')) return char;
      return `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    })
    .join('');
}

/** 20130524T000000Z */
export function amzDate(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function canonicalQuery(params: URLSearchParams): string {
  return [...params.entries()]
    .map(([key, value]) => [uriEncode(key), uriEncode(value)] as const)
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

function signature(credentials: SigV4Credentials, now: Date, canonicalRequest: string): { signature: string; scope: string } {
  const service = credentials.service ?? 's3';
  const date = amzDate(now).slice(0, 8);
  const scope = `${date}/${credentials.region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate(now), scope, sha256Hex(canonicalRequest)].join('\n');
  let key = hmac(`AWS4${credentials.secretAccessKey}`, date);
  for (const part of [credentials.region, service, 'aws4_request']) key = hmac(key, part);
  return { signature: createHmac('sha256', key).update(stringToSign).digest('hex'), scope };
}

/**
 * Signs a request and returns every header to send (the given ones plus
 * host, x-amz-date, x-amz-content-sha256 and authorization).
 */
export function signRequest(
  input: { method: string; url: string; headers?: Record<string, string>; payloadHash?: string; now?: Date },
  credentials: SigV4Credentials,
): Record<string, string> {
  const url = new URL(input.url);
  const now = input.now ?? new Date();
  const payloadHash = input.payloadHash ?? UNSIGNED_PAYLOAD;
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers ?? {})) headers[name.toLowerCase()] = value.trim().replace(/\s+/g, ' ');
  headers.host = url.host;
  headers['x-amz-date'] = amzDate(now);
  headers['x-amz-content-sha256'] = payloadHash;
  const names = Object.keys(headers).sort();
  const canonicalRequest = [
    input.method.toUpperCase(),
    uriEncode(decodeURIComponent(url.pathname), true),
    canonicalQuery(url.searchParams),
    names.map((name) => `${name}:${headers[name]}\n`).join(''),
    names.join(';'),
    payloadHash,
  ].join('\n');
  const { signature: sig, scope } = signature(credentials, now, canonicalRequest);
  const { host: _host, ...rest } = headers;
  return { ...rest, authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope},SignedHeaders=${names.join(';')},Signature=${sig}` };
}

/** A URL anyone can GET until it expires (at most 7 days), without credentials. */
export function presignUrl(input: { url: string; expiresIn: number; now?: Date; method?: string }, credentials: SigV4Credentials): string {
  const url = new URL(input.url);
  const now = input.now ?? new Date();
  const service = credentials.service ?? 's3';
  const scope = `${amzDate(now).slice(0, 8)}/${credentials.region}/${service}/aws4_request`;
  url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
  url.searchParams.set('X-Amz-Credential', `${credentials.accessKeyId}/${scope}`);
  url.searchParams.set('X-Amz-Date', amzDate(now));
  url.searchParams.set('X-Amz-Expires', String(Math.min(Math.max(1, Math.round(input.expiresIn)), 7 * 24 * 3600)));
  url.searchParams.set('X-Amz-SignedHeaders', 'host');
  const canonicalRequest = [
    (input.method ?? 'GET').toUpperCase(),
    uriEncode(decodeURIComponent(url.pathname), true),
    canonicalQuery(url.searchParams),
    `host:${url.host}\n`,
    'host',
    UNSIGNED_PAYLOAD,
  ].join('\n');
  const { signature: sig } = signature(credentials, now, canonicalRequest);
  // Built by hand so the query is encoded exactly as it was signed.
  return `${url.origin}${uriEncode(decodeURIComponent(url.pathname), true)}?${canonicalQuery(url.searchParams)}&X-Amz-Signature=${sig}`;
}
