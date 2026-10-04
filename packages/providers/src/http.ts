import { ProviderError } from './types';

/** fetch wrapper that maps network failures and non-2xx responses to ProviderError. */
export async function requestJson<T>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 15_000, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new ProviderError(`Request to ${new URL(url).host} failed: ${(error as Error).message}`, {
      retryable: true,
      cause: error,
    });
  }
  const body = await response.text();
  if (!response.ok) {
    throw ProviderError.fromHttpStatus(response.status, `${new URL(url).host} responded ${response.status}: ${extractError(body)}`);
  }
  try {
    return JSON.parse(body) as T;
  } catch (error) {
    throw new ProviderError(`${new URL(url).host} returned invalid JSON`, { retryable: true, cause: error });
  }
}

function extractError(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: string; error_description?: string; message?: string };
    return parsed.error_description ?? parsed.error ?? parsed.message ?? body.slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
}
