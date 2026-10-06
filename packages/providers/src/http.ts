import { ProviderError, type MediaItem, type PublishContext } from './types';

export type RequestOptions = RequestInit & {
  timeoutMs?: number;
  /** Network-specific error mapping from the response body (e.g. Graph error codes); falls back to the HTTP status. */
  mapError?: (status: number, body: string) => ProviderError | undefined;
};

/** fetch wrapper that maps network failures and non-2xx responses to ProviderError. */
export async function request(url: string, init: RequestOptions = {}): Promise<Response> {
  const { timeoutMs = 30_000, mapError, ...rest } = init;
  const host = new URL(url).host;
  let response: Response;
  try {
    response = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new ProviderError(`Request to ${host} failed: ${(error as Error).message}`, { retryable: true, cause: error });
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw mapError?.(response.status, body) ?? ProviderError.fromHttpStatus(response.status, `${host} responded ${response.status}: ${extractError(body)}`);
  }
  return response;
}

export async function requestJson<T>(url: string, init: RequestOptions = {}): Promise<T> {
  const response = await request(url, init);
  const body = await response.text();
  try {
    return (body ? JSON.parse(body) : {}) as T;
  } catch (error) {
    throw new ProviderError(`${new URL(url).host} returned invalid JSON`, { retryable: true, cause: error });
  }
}

/** JSON request body + headers. */
export function json(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) };
}

/** application/x-www-form-urlencoded request body + headers. Undefined values are skipped. */
export function form(body: Record<string, string | number | boolean | undefined>, headers: Record<string, string> = {}): RequestInit {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) if (value !== undefined) params.set(key, String(value));
  return { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: params };
}

export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export function basicAuth(user: string, password: string): Record<string, string> {
  return { authorization: `Basic ${btoa(`${user}:${password}`)}` };
}

export function withQuery(url: string, params: Record<string, string | number | boolean | undefined>): string {
  const target = new URL(url);
  for (const [key, value] of Object.entries(params)) if (value !== undefined) target.searchParams.set(key, String(value));
  return target.toString();
}

const MAX_MEDIA_BYTES = 512 * 1024 * 1024;

/** Downloads a media item for networks that need the bytes uploaded rather than a URL. */
export async function downloadMedia(url: string, maxBytes = MAX_MEDIA_BYTES): Promise<{ blob: Blob; mimeType: string }> {
  const response = await request(url, { timeoutMs: 120_000 });
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > maxBytes) throw new ProviderError(`Media file is too large (${Math.round(length / 1e6)} MB).`);
  const blob = await response.blob();
  if (blob.size > maxBytes) throw new ProviderError(`Media file is too large (${Math.round(blob.size / 1e6)} MB).`);
  return { blob, mimeType: blob.type || response.headers.get('content-type') || 'application/octet-stream' };
}

/** The bytes of a media item: from our own storage when the publisher can provide them, else downloaded. */
export async function fetchMedia(item: MediaItem, context: Pick<PublishContext, 'loadMedia'> | undefined, maxBytes = MAX_MEDIA_BYTES): Promise<{ blob: Blob; mimeType: string }> {
  const stored = await context?.loadMedia?.(item);
  if (!stored) return downloadMedia(item.url, maxBytes);
  if (stored.blob.size > maxBytes) throw new ProviderError(`Media file is too large (${Math.round(stored.blob.size / 1e6)} MB).`);
  return stored;
}

/** Polls until `check` returns a value, for networks that process media asynchronously. */
export async function poll<T>(check: () => Promise<T | undefined>, options: { intervalMs?: number; timeoutMs?: number; what: string }): Promise<T> {
  const { intervalMs = 3_000, timeoutMs = 5 * 60_000, what } = options;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result !== undefined) return result;
    if (Date.now() + intervalMs > deadline) throw new ProviderError(`${what} did not finish processing in time.`, { retryable: true });
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function extractError(body: string): string {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const error = parsed.error;
    if (error && typeof error === 'object') {
      const nested = error as { message?: string; error_user_msg?: string; description?: string };
      return nested.error_user_msg ?? nested.message ?? nested.description ?? JSON.stringify(error).slice(0, 200);
    }
    const candidates = [parsed.error_description, error, parsed.message, parsed.detail, parsed.title, parsed.description];
    const found = candidates.find((value) => typeof value === 'string');
    return (found as string | undefined) ?? body.slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
}
