import { eq, lt, sql } from 'drizzle-orm';
import { rateLimits, type Database } from '@postwerk/db';
import type { Locale } from './i18n';
import { timeMessages } from './messages';

export interface RateLimit {
  /** Requests allowed per window. */
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Requests counted in the current window, including this one. */
  count: number;
  /** Milliseconds until the window resets. */
  retryAfterMs: number;
}

/** Limits used by the app; keys are built with `rateLimitKey`. */
export const limits = {
  /** Failed logins per email address. */
  loginEmail: { limit: 10, windowMs: 15 * 60_000 },
  /** Failed logins per IP address. */
  loginIp: { limit: 50, windowMs: 15 * 60_000 },
  /** Sign-ups per IP address. */
  signupIp: { limit: 10, windowMs: 60 * 60_000 },
  /** Emails we send on request (password reset, verification) per address. */
  emailAddress: { limit: 3, windowMs: 60 * 60_000 },
  /** Email requests per IP address. */
  emailIp: { limit: 20, windowMs: 60 * 60_000 },
} satisfies Record<string, RateLimit>;

export function rateLimitKey(scope: string, value: string): string {
  return `${scope}:${value.trim().toLowerCase()}`.slice(0, 300);
}

/**
 * Counts one request against `key` (fixed window) and says whether it is
 * still within the limit. Atomic, so concurrent requests cannot slip through.
 */
export async function hitRateLimit(db: Database, key: string, rule: RateLimit, now = new Date()): Promise<RateLimitResult> {
  // Raw SQL bypasses Drizzle's column mapping, so timestamps go in as ISO strings.
  const at = now.toISOString();
  const resetAt = new Date(now.getTime() + rule.windowMs).toISOString();
  const [row] = await db
    .insert(rateLimits)
    .values({ key, count: 1, resetAt: new Date(resetAt) })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN ${rateLimits.resetAt} <= ${at}::timestamptz THEN 1 ELSE ${rateLimits.count} + 1 END`,
        resetAt: sql`CASE WHEN ${rateLimits.resetAt} <= ${at}::timestamptz THEN ${resetAt}::timestamptz ELSE ${rateLimits.resetAt} END`,
      },
    })
    .returning();
  return { allowed: row!.count <= rule.limit, count: row!.count, retryAfterMs: Math.max(0, row!.resetAt.getTime() - now.getTime()) };
}

/** Whether `key` is over its limit, without counting a request. */
export async function checkRateLimit(db: Database, key: string, rule: RateLimit, now = new Date()): Promise<RateLimitResult> {
  const row = await db.query.rateLimits.findFirst({ where: eq(rateLimits.key, key) });
  if (!row || row.resetAt <= now) return { allowed: true, count: 0, retryAfterMs: 0 };
  return { allowed: row.count < rule.limit, count: row.count, retryAfterMs: row.resetAt.getTime() - now.getTime() };
}

export async function clearRateLimit(db: Database, key: string): Promise<void> {
  await db.delete(rateLimits).where(eq(rateLimits.key, key));
}

/** Drops expired counters (housekeeping; the worker runs it now and then). */
export async function pruneRateLimits(db: Database, now = new Date()): Promise<number> {
  const deleted = await db.delete(rateLimits).where(lt(rateLimits.resetAt, now)).returning({ key: rateLimits.key });
  return deleted.length;
}

/** "in 12 minutes", for "try again …" messages. */
export function retryIn(ms: number, locale: Locale = 'en'): string {
  return timeMessages[locale].retryIn(Math.max(1, Math.ceil(ms / 60_000)));
}
