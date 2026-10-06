import { and, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import { posts, postTargets, socialAccounts, type Database, type PostStatus } from '@postwerk/db';
import { getProvider, ProviderError } from '@postwerk/providers';
import { blueskyKeyset } from './bluesky';
import { publishViaBridge } from './bridge';
import { oauthClientFor } from './clients';
import { decryptJson, encryptJson } from './crypto';
import { mediaForPublishing } from './media';
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

/** A post whose last target just settled, with its final status. */
export interface FinishedPost {
  postId: string;
  status: Extract<PostStatus, 'published' | 'partial' | 'failed'>;
}

/** Publishes one claimed target; returns the post if this was the last of its targets to settle. */
export async function publishTarget(db: Database, targetId: string, now = () => new Date()): Promise<FinishedPost | undefined> {
  const target = await db.query.postTargets.findFirst({
    where: eq(postTargets.id, targetId),
    with: { post: true, account: true },
  });
  if (!target) return undefined;

  try {
    if (target.account.status === 'needs_reauth') {
      throw new ProviderError('Account needs to be reconnected.', { needsReauth: true });
    }
    const { media, loadMedia } = await mediaForPublishing(target.post.media);
    const content = { text: target.text ?? target.post.text, media, options: target.options };
    const context = { idempotencyKey: target.id, client: oauthClientFor(target.account.provider), loadMedia };
    // Bridged accounts publish through the aggregator, which keeps the network tokens fresh itself.
    const result = target.account.bridge
      ? await publishViaBridge(target.account.provider, readCredentials(target.account.credentialsEnc), content, context)
      : await getProvider(target.account.provider).publish(await currentCredentials(db, target.account.id, now()), content, context);
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
  const status = await refreshPostStatus(db, target.postId);
  return status === 'published' || status === 'partial' || status === 'failed' ? { postId: target.postId, status } : undefined;
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

    // Bluesky sessions refresh with Postwerk's own signing key; other networks with the operator's app.
    const client = account.provider === 'bluesky' ? await blueskyKeyset(db) : oauthClientFor(account.provider);
    const refreshed = await provider.refresh(credentials, client);
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

/**
 * Recomputes a post's status from its targets. Returns the new status when
 * the post was still in flight, so exactly one caller sees it finish (the row
 * lock makes a concurrent second update find it already settled).
 */
export async function refreshPostStatus(db: Database, postId: string): Promise<PostStatus | undefined> {
  const targets = await db.select({ status: postTargets.status }).from(postTargets).where(eq(postTargets.postId, postId));
  const [updated] = await db
    .update(posts)
    .set({ status: aggregatePostStatus(targets.map((t) => t.status)), updatedAt: new Date() })
    .where(and(eq(posts.id, postId), inArray(posts.status, ['scheduled', 'publishing'])))
    .returning({ status: posts.status });
  return updated?.status;
}

export interface PublishCycleOptions {
  batchSize?: number;
  now?: () => Date;
  /** Called once per post when its last target settles (e.g. to email the author about failures). */
  onPostFinished?: (post: FinishedPost) => Promise<void>;
}

/** One worker iteration: recover crashed jobs, then publish everything that is due. */
export async function runPublishCycle(db: Database, options: PublishCycleOptions = {}): Promise<number> {
  const now = options.now ?? (() => new Date());
  await releaseStaleLocks(db, now());
  let processed = 0;
  for (;;) {
    const ids = await claimDueTargets(db, options.batchSize ?? 10, now());
    if (ids.length === 0) return processed;
    const finished = await Promise.all(ids.map((id) => publishTarget(db, id, now)));
    for (const post of finished) {
      if (post) await options.onPostFinished?.(post).catch((error: unknown) => console.error('onPostFinished failed', error));
    }
    processed += ids.length;
  }
}
