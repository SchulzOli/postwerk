import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { posts, postTargets, socialAccounts, type Database, type PostMedia } from '@postwerk/db';
import { getProvider, getProviderInfo, resolveOptions, validateContent, type ProviderId } from '@postwerk/providers';

export interface CreatePostInput {
  workspaceId: string;
  authorId: string;
  text: string;
  media?: PostMedia[];
  /** Network-specific fields, keyed by provider (e.g. `{ reddit: { subreddit: 'x' } }`). */
  options?: Partial<Record<ProviderId, Record<string, string>>>;
  accountIds: string[];
  /** null publishes as soon as the worker picks it up. */
  scheduledAt: Date | null;
  draft?: boolean;
}

export type CreatePostResult = { ok: true; postId: string } | { ok: false; errors: string[] };

export async function createPost(db: Database, input: CreatePostInput): Promise<CreatePostResult> {
  const accountIds = [...new Set(input.accountIds)];
  if (accountIds.length === 0) return { ok: false, errors: ['Choose at least one account.'] };

  const accounts = await db.query.socialAccounts.findMany({
    where: and(eq(socialAccounts.workspaceId, input.workspaceId), inArray(socialAccounts.id, accountIds)),
  });
  if (accounts.length !== accountIds.length) return { ok: false, errors: ['One of the selected accounts no longer exists.'] };

  const media = input.media ?? [];
  const errors: string[] = [];
  const targets = accounts.map((account) => {
    const info = getProviderInfo(account.provider);
    const options = resolveOptions(info, input.options?.[account.provider] ?? {});
    const content = { text: input.text, media, options };
    const limits = { maxLength: account.maxLength ?? undefined };
    const issues = account.status === 'needs_reauth' ? ['Account needs to be reconnected.'] : [];
    issues.push(...validateContent(info, content, limits), ...(getProvider(account.provider).validate?.(content, limits) ?? []));
    errors.push(...issues.map((issue) => `${account.handle}: ${issue}`));
    return { socialAccountId: account.id, options };
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
        status: input.draft ? 'draft' : 'scheduled',
        scheduledAt,
      })
      .returning({ id: posts.id });
    await tx.insert(postTargets).values(targets.map((target) => ({ ...target, postId: post!.id, nextAttemptAt: scheduledAt })));
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
