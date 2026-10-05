import { form, poll, requestJson, withQuery, type RequestOptions } from './http';
import { ProviderError } from './types';

/**
 * Shared plumbing for Meta's Graph APIs (Facebook, Instagram, Threads).
 * Meta supports each Graph API version for about two years; bump this
 * when a newer one is released (Threads has its own `v1.0`).
 */
export const GRAPH_VERSION = 'v26.0';

/** How long to wait for media containers (Instagram, Threads). Mutable so tests can speed it up. */
export const containerPolling = { intervalMs: 5_000, timeoutMs: 10 * 60_000 };

type Params = Record<string, string | number | boolean | undefined>;

interface GraphErrorBody {
  error?: {
    message?: string;
    error_user_msg?: string;
    error_message?: string;
    code?: number;
    error_subcode?: number;
    is_transient?: boolean;
  };
}

// https://developers.facebook.com/docs/graph-api/guides/error-handling
// 102/190: session or token invalid; 10 and 200–299: a permission is missing or was removed.
const reauthCodes = (code: number) => code === 102 || code === 190 || code === 10 || (code >= 200 && code <= 299);
// 1/2: temporary outage; 4/17/32/341/613/80001+: rate limits; 9007: Instagram media not ready yet.
const retryCodes = (code: number) => [1, 2, 4, 17, 32, 341, 613, 9007].includes(code) || (code >= 80_001 && code <= 80_014);

/**
 * Graph APIs report errors as `{ error: { code, message } }`, often with HTTP 400
 * even for expired tokens (code 190), so the code decides, not the status.
 */
export function graphError(network: string, status: number, body: string): ProviderError {
  let error: GraphErrorBody['error'];
  try {
    error = (JSON.parse(body) as GraphErrorBody).error;
  } catch {
    error = undefined;
  }
  const detail = error?.error_user_msg || error?.message || error?.error_message || body.slice(0, 200) || `HTTP ${status}`;
  const code = error?.code;
  if (code !== undefined && reauthCodes(code)) {
    return new ProviderError(`${network} access has expired or was revoked. Please reconnect the account. (${detail})`, { needsReauth: true });
  }
  if ((code !== undefined && retryCodes(code)) || error?.is_transient) return new ProviderError(`${network} is busy: ${detail}`, { retryable: true });
  if (code !== undefined && status < 500) return new ProviderError(`${network} rejected the request: ${detail}`);
  return ProviderError.fromHttpStatus(status, `${network} responded ${status}: ${detail}`);
}

/**
 * Like `requestJson` from http.ts, but maps Graph error codes (see `graphError`),
 * which `request` cannot do because it only sees the HTTP status.
 */
export async function graphRequest<T>(network: string, url: string, init: RequestOptions = {}): Promise<T> {
  return requestJson<T>(url, { timeoutMs: 60_000, ...init, mapError: (status, body) => graphError(network, status, body) });
}

/**
 * Small Graph client: paths are relative to `base` unless they are absolute
 * URLs (paging links, unversioned token endpoints). Tokens travel as the
 * `access_token` parameter, which every Meta host documents.
 */
export function graphApi(network: string, base: string) {
  const resolve = (path: string) => (path.startsWith('https://') ? path : `${base}${path}`);
  return {
    get: <T>(path: string, params: Params = {}) => graphRequest<T>(network, withQuery(resolve(path), params)),
    post: <T>(path: string, params: Params) => graphRequest<T>(network, resolve(path), form(params)),
  };
}

/** Waits until an Instagram or Threads media container has been processed. */
export async function waitForContainer(network: string, read: () => Promise<{ state?: string; detail?: string }>): Promise<void> {
  await poll(
    async () => {
      const { state, detail } = await read();
      if (state === 'FINISHED' || state === 'PUBLISHED') return true;
      if (state === 'ERROR' || state === 'EXPIRED') {
        throw new ProviderError(`${network} could not process the media${detail ? `: ${detail}` : '. Check the file format and size.'}`);
      }
      return undefined;
    },
    { what: `${network} media`, ...containerPolling },
  );
}

/** Token responses from Meta's exchange and refresh endpoints. */
export interface MetaTokenResponse {
  access_token: string;
  expires_in?: number;
  user_id?: string | number;
}

/** Long-lived Instagram and Threads tokens last 60 days; assume that if the response omits it. */
export const LONG_LIVED_SECONDS = 60 * 24 * 60 * 60;

/** Refreshing only extends a token; when it fails for any non-transient reason the user has to reconnect. */
export function asReauth(network: string) {
  return (error: unknown): never => {
    if (error instanceof ProviderError && !error.retryable && !error.needsReauth) {
      throw new ProviderError(`${network} access could not be renewed. Please reconnect the account. (${error.message})`, { needsReauth: true, cause: error });
    }
    throw error;
  };
}
