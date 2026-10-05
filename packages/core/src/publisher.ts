import { and, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import { posts, postTargets, socialAccounts, type Database } from '@postwerk/db';
import { getProvider, ProviderError } from '@postwerk/providers';
import { oauthClientFor } from './clients';
import { decryptJson, encryptJson } from './crypto';
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
    const credentials = await currentCredentials(db, target.account.id, now());
    const result = await provider.publish(
      credentials,
      { text: target.text ?? target.post.text, media: target.post.media, options: target.options },
      { idempotencyKey: target.id, client: oauthClientFor(target.account.provider) },
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

/**
 * Decrypted credentials, refreshed first when the network's token is about to
 * expire. The account row is locked during a refresh so that two targets of the
 * same account never refresh concurrently (X and others rotate refresh tokens).
 */
async function currentCredentials(db: Database, accountId: string, now: Date): Promise<unknown> {
  return db.transaction(async (tx) => {
    const [account] = await tx.select().from(socialAccounts).where(eq(socialAccounts.id, accountId)).for('update');
    if (!account) throw new ProviderError('The account was disconnected.');
    const credentials = readCredentials(account.credentialsEnc);
    const provider = getProvider(account.provider);
    if (!provider.refresh || !provider.needsRefresh?.(credentials, now.getTime())) return credentials;

    const refreshed = await provider.refresh(credentials, oauthClientFor(account.provider));
    await tx.update(socialAccounts).set({ credentialsEnc: encryptJson(refreshed), updatedAt: now }).where(eq(socialAccounts.id, account.id));
    await updateSiblingGrants(tx, account, credentials, refreshed, now);
    return refreshed;
  });
}

type Tokens = { accessToken?: unknown; refreshToken?: unknown; expiresAt?: unknown };

/**
 * One login can produce several accounts (Facebook/LinkedIn pages, Pinterest
 * boards) that share a single grant. When a refresh rotates the refresh token,
 * the siblings' copies become invalid, so they get the new tokens too.
 */
async function updateSiblingGrants(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  account: typeof socialAccounts.$inferSelect,
  before: unknown,
  after: unknown,
  now: Date,
) {
  const previous = (before as Tokens).refreshToken;
  const next = after as Tokens;
  if (typeof previous !== 'string' || previous === next.refreshToken) return;
  const siblings = await tx
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.workspaceId, account.workspaceId), eq(socialAccounts.provider, account.provider), ne(socialAccounts.id, account.id)));
  for (const sibling of siblings) {
    let credentials: Tokens;
    try {
      credentials = decryptJson<Tokens>(sibling.credentialsEnc);
    } catch {
      continue;
    }
    if (credentials.refreshToken !== previous) continue;
    const updated = { ...credentials, accessToken: next.accessToken, refreshToken: next.refreshToken, expiresAt: next.expiresAt };
    await tx.update(socialAccounts).set({ credentialsEnc: encryptJson(updated), updatedAt: now }).where(eq(socialAccounts.id, sibling.id));
  }
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
