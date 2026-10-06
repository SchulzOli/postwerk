import { and, asc, eq, gte, lt, notInArray } from 'drizzle-orm';
import { posts, postTargets, socialAccounts, type Database, type PostMedia, type PostStatus, type Transaction } from '@postwerk/db';
import { countText, getProvider, getProviderInfo, isProviderId, resolveOptions, textLimit, validateContent, type ProviderId } from '@postwerk/providers';
import { planPost, type TextVariants } from './flow';
import { getFlow } from './flows';

export interface PostInput {
  workspaceId: string;
  text: string;
  media?: PostMedia[];
  /** Network-specific fields, keyed by provider (e.g. `{ reddit: { subreddit: 'x' } }`). */
  options?: Partial<Record<ProviderId, Record<string, string>>>;
  /** Per-network versions of the text; empty ones fall back to `text`. */
  variants?: TextVariants;
  /** Accounts to publish to directly. Ignored when `flowId` is set. */
  accountIds?: string[];
  /** A flow decides the accounts, per-account text and delays. */
  flowId?: string;
  /** null publishes as soon as the worker picks it up. */
  scheduledAt: Date | null;
  draft?: boolean;
}

export interface CreatePostInput extends PostInput {
  authorId: string;
}

export type CreatePostResult = { ok: true; postId: string } | { ok: false; errors: string[] };
export type UpdateResult = { ok: true } | { ok: false; errors: string[] };

/** A post can be changed until its first network starts publishing. */
export const EDITABLE_STATUSES: PostStatus[] = ['draft', 'scheduled', 'failed'];

const MAX_VARIANT_LENGTH = 100_000;

interface PreparedTarget {
  socialAccountId: string;
  options: Record<string, string>;
  text: string | null;
  delayMinutes: number;
}

/** Validates a post against every account it goes to and works out the targets (shared by create and update). */
async function prepareTargets(db: Database | Transaction, input: PostInput): Promise<{ ok: true; targets: PreparedTarget[]; variants: TextVariants } | { ok: false; errors: string[] }> {
  const media = input.media ?? [];
  const workspaceAccounts = await db.query.socialAccounts.findMany({ where: eq(socialAccounts.workspaceId, input.workspaceId) });
  const byId = new Map(workspaceAccounts.map((account) => [account.id, account]));
  const providerOf = (accountId: string) => byId.get(accountId)?.provider;

  let graph;
  let flowName = '';
  if (input.flowId) {
    const flow = await getFlow(db, input.workspaceId, input.flowId);
    if (!flow) return { ok: false, errors: ['The selected flow no longer exists.'] };
    graph = flow.graph;
    flowName = flow.name;
  }
  const measure = (accountId: string, text: string) => {
    const account = byId.get(accountId);
    if (!account) return { length: 0, max: Infinity };
    const info = getProviderInfo(account.provider);
    return { length: countText(text, info.capabilities.text.counter), max: textLimit(info, { media }, { maxLength: account.maxLength ?? undefined }) };
  };
  const plan = planPost({ text: input.text, variants: input.variants ?? {}, providerOf, graph, accountIds: input.accountIds }, measure);
  if (plan.errors.length > 0) return { ok: false, errors: plan.errors.map((error) => `${flowName}: ${error}`) };
  if (plan.targets.length === 0) return { ok: false, errors: ['Choose at least one account.'] };
  if (plan.targets.some((target) => !byId.has(target.accountId))) return { ok: false, errors: ['One of the selected accounts no longer exists.'] };

  const errors: string[] = [];
  const targets = plan.targets.map((target) => {
    const account = byId.get(target.accountId)!;
    const info = getProviderInfo(account.provider);
    const options = resolveOptions(info, input.options?.[account.provider] ?? {});
    const content = { text: target.text, media, options };
    const limits = { maxLength: account.maxLength ?? undefined };
    const issues = account.status === 'needs_reauth' ? ['Account needs to be reconnected.'] : [];
    issues.push(...validateContent(info, content, limits), ...(getProvider(account.provider).validate?.(content, limits) ?? []));
    errors.push(...issues.map((issue) => `${account.handle}: ${issue}`));
    return { socialAccountId: account.id, options, text: target.text === input.text ? null : target.text, delayMinutes: target.delayMinutes };
  });
  if (errors.length > 0) return { ok: false, errors };

  // Keep only versions for networks the post goes to, and only real changes.
  const used = new Set(plan.targets.map((target) => providerOf(target.accountId)));
  const variants: TextVariants = {};
  for (const [provider, text] of Object.entries(input.variants ?? {})) {
    if (isProviderId(provider) && used.has(provider) && text?.trim() && text !== input.text) variants[provider] = text.slice(0, MAX_VARIANT_LENGTH);
  }
  return { ok: true, targets, variants };
}

const targetRows = (postId: string, scheduledAt: Date, targets: PreparedTarget[]) =>
  targets.map((target) => ({ ...target, postId, nextAttemptAt: new Date(scheduledAt.getTime() + target.delayMinutes * 60_000) }));

export async function createPost(db: Database, input: CreatePostInput): Promise<CreatePostResult> {
  const prepared = await prepareTargets(db, input);
  if (!prepared.ok) return prepared;
  const scheduledAt = input.scheduledAt ?? new Date();
  const postId = await db.transaction(async (tx) => {
    const [post] = await tx
      .insert(posts)
      .values({
        workspaceId: input.workspaceId,
        authorId: input.authorId,
        text: input.text,
        media: input.media ?? [],
        variants: prepared.variants,
        flowId: input.flowId ?? null,
        status: input.draft ? 'draft' : 'scheduled',
        scheduledAt,
      })
      .returning({ id: posts.id });
    await tx.insert(postTargets).values(targetRows(post!.id, scheduledAt, prepared.targets));
    return post!.id;
  });
  return { ok: true, postId };
}

/**
 * Locks a post and its targets for a change. Fails when the post went
 * (partly) out or a network is publishing it right now; the locks keep the
 * worker from claiming it meanwhile.
 */
async function lockEditable(tx: Transaction, workspaceId: string, postId: string, allowed: PostStatus[] = EDITABLE_STATUSES) {
  const [post] = await tx.select().from(posts).where(and(eq(posts.id, postId), eq(posts.workspaceId, workspaceId))).for('update');
  if (!post) return { error: 'This post no longer exists.' } as const;
  const targets = await tx.select().from(postTargets).where(eq(postTargets.postId, postId)).for('update');
  if (!allowed.includes(post.status) || targets.some((target) => target.status === 'publishing' || target.status === 'published')) {
    return { error: 'This post is already going out, so it cannot be changed anymore.' } as const;
  }
  return { post, targets } as const;
}

/** Replaces a not-yet-published post: text, media, accounts or flow, per-network texts and time. */
export async function updatePost(db: Database, postId: string, input: PostInput): Promise<UpdateResult> {
  return db.transaction(async (tx) => {
    const locked = await lockEditable(tx, input.workspaceId, postId);
    if ('error' in locked) return { ok: false, errors: [locked.error!] };
    const prepared = await prepareTargets(tx, input);
    if (!prepared.ok) return prepared;
    const scheduledAt = input.scheduledAt ?? new Date();
    await tx
      .update(posts)
      .set({
        text: input.text,
        media: input.media ?? [],
        variants: prepared.variants,
        flowId: input.flowId ?? null,
        status: input.draft ? 'draft' : 'scheduled',
        scheduledAt,
        updatedAt: new Date(),
      })
      .where(eq(posts.id, postId));
    await tx.delete(postTargets).where(eq(postTargets.postId, postId));
    await tx.insert(postTargets).values(targetRows(postId, scheduledAt, prepared.targets));
    return { ok: true };
  });
}

/** Moves a scheduled post (and its flow's delayed targets) to a new time. */
export async function reschedulePost(db: Database, workspaceId: string, postId: string, scheduledAt: Date): Promise<UpdateResult> {
  if (Number.isNaN(scheduledAt.getTime())) return { ok: false, errors: ['Please pick a date and time.'] };
  return db.transaction(async (tx) => {
    const locked = await lockEditable(tx, workspaceId, postId, ['draft', 'scheduled']);
    if ('error' in locked) return { ok: false, errors: [locked.error!] };
    await tx.update(posts).set({ scheduledAt, updatedAt: new Date() }).where(eq(posts.id, postId));
    for (const target of locked.targets) {
      await tx
        .update(postTargets)
        .set({ nextAttemptAt: new Date(scheduledAt.getTime() + target.delayMinutes * 60_000) })
        .where(eq(postTargets.id, target.id));
    }
    return { ok: true };
  });
}

/** Tries the failed networks of a post again, right away. Returns false if nothing had failed. */
export async function retryPost(db: Database, workspaceId: string, postId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [post] = await tx.select().from(posts).where(and(eq(posts.id, postId), eq(posts.workspaceId, workspaceId))).for('update');
    if (!post || (post.status !== 'failed' && post.status !== 'partial')) return false;
    const retried = await tx
      .update(postTargets)
      .set({ status: 'pending', attempts: 0, lastError: null, lockedAt: null, nextAttemptAt: new Date() })
      .where(and(eq(postTargets.postId, postId), eq(postTargets.status, 'failed')))
      .returning({ id: postTargets.id });
    if (retried.length === 0) return false;
    await tx.update(posts).set({ status: 'publishing', updatedAt: new Date() }).where(eq(posts.id, postId));
    return true;
  });
}

/** Everything the composer needs to edit a post (or reuse it as a new one). */
export async function getPostForEdit(db: Database, workspaceId: string, postId: string) {
  const post = await db.query.posts.findFirst({
    where: and(eq(posts.id, postId), eq(posts.workspaceId, workspaceId)),
    with: { targets: { with: { account: true } } },
  });
  if (!post) return undefined;
  // Options are stored per target; the composer works per network.
  const options: Partial<Record<ProviderId, Record<string, string>>> = {};
  for (const target of post.targets) options[target.account.provider] ??= target.options;
  return {
    id: post.id,
    status: post.status,
    editable: EDITABLE_STATUSES.includes(post.status),
    text: post.text,
    media: post.media,
    variants: post.variants,
    flowId: post.flowId,
    accountIds: post.targets.map((target) => target.socialAccountId),
    options,
    scheduledAt: post.scheduledAt,
  };
}

/** Deletes a post unless it has already (partly) gone out; returns its text, or undefined if nothing was deleted. */
export async function deletePost(db: Database, workspaceId: string, postId: string): Promise<string | undefined> {
  const [deleted] = await db
    .delete(posts)
    .where(and(eq(posts.id, postId), eq(posts.workspaceId, workspaceId), notInArray(posts.status, ['publishing', 'published', 'partial'])))
    .returning({ text: posts.text });
  return deleted?.text;
}

export async function listPosts(db: Database, workspaceId: string) {
  return db.query.posts.findMany({
    where: eq(posts.workspaceId, workspaceId),
    orderBy: (p, { desc }) => [desc(p.scheduledAt)],
    limit: 100,
    with: { targets: { with: { account: true } } },
  });
}

/** Posts scheduled within [from, to), oldest first (for the calendar). */
export async function listPostsBetween(db: Database, workspaceId: string, from: Date, to: Date) {
  return db.query.posts.findMany({
    where: and(eq(posts.workspaceId, workspaceId), gte(posts.scheduledAt, from), lt(posts.scheduledAt, to)),
    orderBy: [asc(posts.scheduledAt)],
    limit: 500,
    with: { targets: { with: { account: true } } },
  });
}

