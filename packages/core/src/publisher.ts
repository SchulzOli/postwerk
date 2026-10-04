import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { posts, postTargets, socialAccounts, type Database } from '@postwerk/db';
import { getProvider, ProviderError } from '@postwerk/providers';
import { decryptJson } from './crypto';
import { aggregatePostStatus, backoffMs, MAX_ATTEMPTS } from './status';

const STALE_LOCK_MS = 10 * 60_000;

/**
 * Atomically moves due targets to "publishing" so that several workers can
 * run side by side without publishing the same target twice.
 */
export async function claimDueTargets(db: Database, limit = 10, now = new Date()): Promise<string[]> {
  // Raw queries bypass Drizzle's column mapping, so timestamps go in as ISO strings.
  const at = now.toISOString();
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE ${postTargets} SET status = 'publishing', locked_at = ${at}, attempts = attempts + 1
    WHERE id IN (
      SELECT pt.id FROM ${postTargets} pt
      JOIN ${posts} p ON p.id = pt.post_id
      WHERE pt.status = 'pending'
        AND pt.next_attempt_at <= ${at}
        AND p.status IN ('scheduled', 'publishing')
      ORDER BY pt.next_attempt_at
      LIMIT ${limit}
      FOR UPDATE OF pt SKIP LOCKED
    )
    RETURNING id
  `);
  return rows.map((row) => row.id);
}

/** Targets stuck in "publishing" (worker crashed mid-publish) are put back in the queue. */
export async function releaseStaleLocks(db: Database, now = new Date()): Promise<number> {
  const released = await db
    .update(postTargets)
    .set({ status: 'pending', lockedAt: null, nextAttemptAt: now })
    .where(and(eq(postTargets.status, 'publishing'), lt(postTargets.lockedAt, new Date(now.getTime() - STALE_LOCK_MS))))
    .returning({ id: postTargets.id });
  return released.length;
}

export async function publishTarget(db: Database, targetId: string, now = () => new Date()): Promise<void> {
  const target = await db.query.postTargets.findFirst({
    where: eq(postTargets.id, targetId),
    with: { post: true, account: true },
  });
  if (!target) return;

  try {
    if (target.account.status === 'needs_reauth') {
      throw new ProviderError('Account needs to be reconnected.', { needsReauth: true });
    }
    const provider = getProvider(target.account.provider);
    const result = await provider.publish(
      readCredentials(target.account.credentialsEnc),
      { text: target.post.text },
      { idempotencyKey: target.id },
    );
    await db
      .update(postTargets)
      .set({ status: 'published', lockedAt: null, lastError: null, remoteId: result.remoteId, remoteUrl: result.url ?? null, publishedAt: now() })
      .where(eq(postTargets.id, target.id));
  } catch (error) {
    const providerError = error instanceof ProviderError ? error : new ProviderError((error as Error).message, { retryable: true, cause: error });
    const retry = providerError.retryable && target.attempts < MAX_ATTEMPTS;
    if (providerError.needsReauth) {
      await db.update(socialAccounts).set({ status: 'needs_reauth', updatedAt: now() }).where(eq(socialAccounts.id, target.account.id));
    }
    await db
      .update(postTargets)
      .set({
        status: retry ? 'pending' : 'failed',
        lockedAt: null,
        lastError: providerError.message,
        nextAttemptAt: retry ? new Date(now().getTime() + backoffMs(target.attempts)) : target.nextAttemptAt,
      })
      .where(eq(postTargets.id, target.id));
  }
  await refreshPostStatus(db, target.postId);
}

function readCredentials(payload: string): unknown {
  try {
    return decryptJson(payload);
  } catch (error) {
    throw new ProviderError('Stored credentials could not be decrypted (was ENCRYPTION_KEY changed?). Please reconnect the account.', {
      needsReauth: true,
      cause: error,
    });
  }
}

export async function refreshPostStatus(db: Database, postId: string): Promise<void> {
  const targets = await db.select({ status: postTargets.status }).from(postTargets).where(eq(postTargets.postId, postId));
  await db
    .update(posts)
    .set({ status: aggregatePostStatus(targets.map((t) => t.status)), updatedAt: new Date() })
    .where(and(eq(posts.id, postId), inArray(posts.status, ['scheduled', 'publishing'])));
}

/** One worker iteration: recover crashed jobs, then publish everything that is due. */
export async function runPublishCycle(db: Database, options: { batchSize?: number; now?: () => Date } = {}): Promise<number> {
  const now = options.now ?? (() => new Date());
  await releaseStaleLocks(db, now());
  let processed = 0;
  for (;;) {
    const ids = await claimDueTargets(db, options.batchSize ?? 10, now());
    if (ids.length === 0) return processed;
    await Promise.all(ids.map((id) => publishTarget(db, id, now)));
    processed += ids.length;
  }
}
