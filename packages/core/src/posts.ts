import { and, eq, notInArray } from 'drizzle-orm';
import { posts, postTargets, socialAccounts, type Database, type PostMedia } from '@postwerk/db';
import { countText, getProvider, getProviderInfo, resolveOptions, textLimit, validateContent, type ProviderId } from '@postwerk/providers';
import { planFlow } from './flow';
import { getFlow } from './flows';

export interface CreatePostInput {
  workspaceId: string;
  authorId: string;
  text: string;
  media?: PostMedia[];
  /** Network-specific fields, keyed by provider (e.g. `{ reddit: { subreddit: 'x' } }`). */
  options?: Partial<Record<ProviderId, Record<string, string>>>;
  /** Accounts to publish to directly. Ignored when `flowId` is set. */
  accountIds?: string[];
  /** A flow decides the accounts, per-account text and delays. */
  flowId?: string;
  /** null publishes as soon as the worker picks it up. */
  scheduledAt: Date | null;
  draft?: boolean;
}

export type CreatePostResult = { ok: true; postId: string } | { ok: false; errors: string[] };

interface Plan {
  accountId: string;
  text: string;
  delayMinutes: number;
}

export async function createPost(db: Database, input: CreatePostInput): Promise<CreatePostResult> {
  const media = input.media ?? [];
  const workspaceAccounts = await db.query.socialAccounts.findMany({ where: eq(socialAccounts.workspaceId, input.workspaceId) });
  const byId = new Map(workspaceAccounts.map((account) => [account.id, account]));

  let plans: Plan[];
  if (input.flowId) {
    const flow = await getFlow(db, input.workspaceId, input.flowId);
    if (!flow) return { ok: false, errors: ['The selected flow no longer exists.'] };
    const measure = (accountId: string, text: string) => {
      const account = byId.get(accountId);
      if (!account) return { length: 0, max: Infinity };
      const info = getProviderInfo(account.provider);
      return { length: countText(text, info.capabilities.text.counter), max: textLimit(info, { media }, { maxLength: account.maxLength ?? undefined }) };
    };
    const plan = planFlow(flow.graph, input.text, measure);
    if (plan.errors.length > 0) return { ok: false, errors: plan.errors.map((error) => `${flow.name}: ${error}`) };
    plans = plan.targets;
  } else {
    plans = [...new Set(input.accountIds ?? [])].map((accountId) => ({ accountId, text: input.text, delayMinutes: 0 }));
  }
  if (plans.length === 0) return { ok: false, errors: ['Choose at least one account.'] };
  if (plans.some((plan) => !byId.has(plan.accountId))) return { ok: false, errors: ['One of the selected accounts no longer exists.'] };

  const errors: string[] = [];
  const targets = plans.map((plan) => {
    const account = byId.get(plan.accountId)!;
    const info = getProviderInfo(account.provider);
    const options = resolveOptions(info, input.options?.[account.provider] ?? {});
    const content = { text: plan.text, media, options };
    const limits = { maxLength: account.maxLength ?? undefined };
    const issues = account.status === 'needs_reauth' ? ['Account needs to be reconnected.'] : [];
    issues.push(...validateContent(info, content, limits), ...(getProvider(account.provider).validate?.(content, limits) ?? []));
    errors.push(...issues.map((issue) => `${account.handle}: ${issue}`));
    return { socialAccountId: account.id, options, text: plan.text === input.text ? null : plan.text, delayMinutes: plan.delayMinutes };
  });
  if (errors.length > 0) return { ok: false, errors };

  const scheduledAt = input.scheduledAt ?? new Date();
  const postId = await db.transaction(async (tx) => {
    const [post] = await tx
      .insert(posts)
      .values({
        workspaceId: input.workspaceId,
        authorId: input.authorId,
        text: input.text,
        media,
        flowId: input.flowId ?? null,
        status: input.draft ? 'draft' : 'scheduled',
        scheduledAt,
      })
      .returning({ id: posts.id });
    await tx.insert(postTargets).values(
      targets.map(({ delayMinutes, ...target }) => ({
        ...target,
        postId: post!.id,
        nextAttemptAt: new Date(scheduledAt.getTime() + delayMinutes * 60_000),
      })),
    );
    return post!.id;
  });
  return { ok: true, postId };
}

/** Deletes a post unless it has already (partly) gone out. */
export async function deletePost(db: Database, workspaceId: string, postId: string): Promise<boolean> {
  const deleted = await db
    .delete(posts)
    .where(and(eq(posts.id, postId), eq(posts.workspaceId, workspaceId), notInArray(posts.status, ['publishing', 'published', 'partial'])))
    .returning({ id: posts.id });
  return deleted.length > 0;
}

export async function listPosts(db: Database, workspaceId: string) {
  return db.query.posts.findMany({
    where: eq(posts.workspaceId, workspaceId),
    orderBy: (p, { desc }) => [desc(p.scheduledAt)],
    limit: 100,
    with: { targets: { with: { account: true } } },
  });
}
