import 'server-only';
import { asc, eq } from 'drizzle-orm';
import { getPostForEdit, listFlows } from '@postwerk/core';
import { getDb, socialAccounts } from '@postwerk/db';
import type { ComposerAccount, ComposerInitial } from '@/components/composer';
import { commonMessages } from '@/messages/common';
import { getMessages } from './i18n-server';

/** Accounts and flows the composer offers in a workspace. */
export async function loadComposerChoices(workspaceId: string) {
  const db = getDb();
  const [accounts, flows, common] = await Promise.all([
    db.query.socialAccounts.findMany({ where: eq(socialAccounts.workspaceId, workspaceId), orderBy: [asc(socialAccounts.provider), asc(socialAccounts.handle)] }),
    listFlows(db, workspaceId),
    getMessages(commonMessages),
  ]);
  return {
    accounts: accounts.map(
      (account): ComposerAccount => ({
        id: account.id,
        handle: account.handle,
        provider: account.provider,
        maxLength: account.maxLength,
        disabledReason: account.status === 'needs_reauth' ? common.reconnectNeeded : undefined,
      }),
    ),
    flows: flows.map((flow) => ({ id: flow.id, name: flow.name, graph: flow.graph })),
  };
}

/** A post as the composer's starting values; `asCopy` starts a new post from it ("use again"). */
export async function loadComposerInitial(workspaceId: string, postId: string, asCopy = false): Promise<ComposerInitial | undefined> {
  const post = await getPostForEdit(getDb(), workspaceId, postId);
  if (!post || (!asCopy && !post.editable)) return undefined;
  return {
    postId: asCopy ? undefined : post.id,
    text: post.text,
    media: post.media.map((item, index) => ({
      localId: `${index}-${item.mediaId ?? item.url}`,
      id: item.mediaId,
      url: item.url,
      kind: item.kind,
      size: item.size,
      mimeType: item.mimeType,
      altText: item.altText ?? '',
    })),
    accountIds: post.accountIds,
    flowId: post.flowId ?? '',
    options: post.options,
    variants: Object.fromEntries(Object.entries(post.variants).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
    scheduledAt: !asCopy && post.scheduledAt && post.scheduledAt.getTime() > Date.now() ? post.scheduledAt.toISOString() : null,
  };
}
