import { lt } from 'drizzle-orm';
import { emailTokens, oauthStates, sessions, type Database } from '@postwerk/db';
import { forgetOldAuditIps } from './audit';
import { recordAllBridgeUsage } from './bridge-usage';
import { cleanupUnusedMedia } from './media';
import { pruneRateLimits } from './ratelimit';

/** Periodic work the worker runs: cleans up expired rate-limit counters, sign-in states, sessions, email links, unused uploads and old IP addresses, and notes bridge usage for the month. */
export async function runHousekeeping(db: Database, now = new Date()): Promise<void> {
  await pruneRateLimits(db, now);
  await db.delete(oauthStates).where(lt(oauthStates.expiresAt, now));
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
  await db.delete(emailTokens).where(lt(emailTokens.expiresAt, now));
  await cleanupUnusedMedia(db);
  await forgetOldAuditIps(db, now);
  await recordAllBridgeUsage(db, now);
}
