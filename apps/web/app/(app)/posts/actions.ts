'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createPost, deletePost } from '@postwerk/core';
import { getDb } from '@postwerk/db';
import { isProviderId, type ProviderId } from '@postwerk/providers';
import { record } from '@/lib/audit';
import { parseMediaLines } from '@/lib/media';
import { requireSession } from '@/lib/session';

export type ComposeState = { errors?: string[] };

/** The start of a post, for the activity log. */
const excerpt = (text: string) => (text.length > 80 ? `${text.slice(0, 79)}…` : text) || '(media only)';

/** Collects "option:<provider>:<key>" form fields into `{ provider: { key: value } }`. */
function readOptions(form: FormData): Partial<Record<ProviderId, Record<string, string>>> {
  const options: Partial<Record<ProviderId, Record<string, string>>> = {};
  for (const [name, value] of form.entries()) {
    const [prefix, provider, key] = name.split(':');
    if (prefix !== 'option' || !provider || !key || !isProviderId(provider) || typeof value !== 'string') continue;
    (options[provider] ??= {})[key] = value;
  }
  return options;
}

export async function submitPost(_: ComposeState, form: FormData): Promise<ComposeState> {
  const { user, workspace } = await requireSession();
  const text = String(form.get('text') ?? '');
  const accountIds = form.getAll('accountIds').map(String);
  const { media, errors: mediaErrors } = parseMediaLines(String(form.get('media') ?? ''));
  if (mediaErrors.length > 0) return { errors: mediaErrors };

  let scheduledAt: Date | null = null;
  if (String(form.get('when') ?? 'now') === 'later') {
    scheduledAt = new Date(String(form.get('scheduledAt') ?? ''));
    if (Number.isNaN(scheduledAt.getTime())) return { errors: ['Please pick a date and time.'] };
    if (scheduledAt.getTime() < Date.now() - 60_000) return { errors: ['The scheduled time is in the past.'] };
  }

  const flowId = String(form.get('flowId') ?? '') || undefined;
  const result = await createPost(getDb(), {
    workspaceId: workspace.id,
    authorId: user.id,
    text,
    media,
    options: readOptions(form),
    ...(flowId ? { flowId } : { accountIds }),
    scheduledAt,
  });
  if (!result.ok) return { errors: result.errors };
  await record({ action: 'post.created', userId: user.id, workspaceId: workspace.id, target: excerpt(text), details: { scheduled: scheduledAt !== null } });
  revalidatePath('/posts');
  revalidatePath('/canvas');
  redirect(form.get('returnTo') === '/canvas' ? '/canvas#n=panel:posts' : '/posts');
}

export async function removePost(form: FormData) {
  const { user, workspace } = await requireSession();
  const text = await deletePost(getDb(), workspace.id, String(form.get('postId')));
  if (text !== undefined) await record({ action: 'post.deleted', userId: user.id, workspaceId: workspace.id, target: excerpt(text) });
  revalidatePath('/posts');
  revalidatePath('/canvas');
}
