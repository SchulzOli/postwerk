import 'server-only';
import { headers } from 'next/headers';

/**
 * The client's IP address as reported by the reverse proxy in front of
 * Postwerk (X-Forwarded-For / X-Real-IP). Without a proxy that sets these
 * headers it is "unknown" or whatever the client claims — per-IP limits are a
 * second line of defense; per-email limits do not depend on it.
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip')?.trim() || 'unknown';
}
