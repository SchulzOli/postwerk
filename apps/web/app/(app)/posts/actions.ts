'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createPost, deletePost } from '@postwerk/core';
import { getDb } from '@postwerk/db';
import { requireSession } from '@/lib/session';

export type ComposeState = { errors?: string[] };

export async function submitPost(_: ComposeState, form: FormData): Promise<ComposeState> {
  const { user, workspace } = await requireSession();
  const text = String(form.get('text') ?? '');
  const accountIds = form.getAll('accountIds').map(String);
  const when = String(form.get('when') ?? 'now');
  let scheduledAt: Date | null = null;
  if (when === 'later') {
    scheduledAt = new Date(String(form.get('scheduledAt') ?? ''));
    if (Number.isNaN(scheduledAt.getTime())) return { errors: ['Please pick a date and time.'] };
    if (scheduledAt.getTime() < Date.now() - 60_000) return { errors: ['The scheduled time is in the past.'] };
  }

  const result = await createPost(getDb(), { workspaceId: workspace.id, authorId: user.id, text, accountIds, scheduledAt });
  if (!result.ok) return { errors: result.errors };
  revalidatePath('/posts');
  redirect('/posts');
}

export async function removePost(form: FormData) {
  const { workspace } = await requireSession();
  await deletePost(getDb(), workspace.id, String(form.get('postId')));
  revalidatePath('/posts');
}
