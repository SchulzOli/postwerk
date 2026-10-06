'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createPost, deletePost, reschedulePost, retryPost, updatePost } from '@postwerk/core';
import { getDb } from '@postwerk/db';
import { isProviderId, type ProviderId } from '@postwerk/providers';
import { record } from '@/lib/audit';
import { getLocale, getMessages } from '@/lib/i18n-server';
import type { ComposerInitial } from '@/components/composer';
import type { CalendarData } from '@/lib/calendar';
import { loadCalendar, MAX_CALENDAR_SPAN } from '@/lib/calendar-server';
import { loadComposerInitial } from '@/lib/compose';
import { readComposerMedia } from '@/lib/media-server';
import { requireSession } from '@/lib/session';
import { postsMessages } from '@/messages/posts';

/** `saved` changes on every successful save from the canvas, which then resets the composer. */
export type ComposeState = { errors?: string[]; saved?: number };

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

/** Collects "variant:<provider>" fields: the per-network versions of the text. */
function readVariants(form: FormData): Partial<Record<ProviderId, string>> {
  const variants: Partial<Record<ProviderId, string>> = {};
  for (const [name, value] of form.entries()) {
    const [prefix, provider] = name.split(':');
    if (prefix === 'variant' && provider && isProviderId(provider) && typeof value === 'string') variants[provider] = value;
  }
  return variants;
}

/** Creates a post, or saves changes to one when the form carries a postId. */
export async function submitPost(_: ComposeState, form: FormData): Promise<ComposeState> {
  const { user, workspace } = await requireSession();
  const [locale, t] = await Promise.all([getLocale(), getMessages(postsMessages)]);
  const postId = String(form.get('postId') ?? '') || undefined;
  const text = String(form.get('text') ?? '');
  const accountIds = form.getAll('accountIds').map(String);
  const { media, errors: mediaErrors } = await readComposerMedia(String(form.get('media') ?? ''), workspace.id, locale);
  if (mediaErrors.length > 0) return { errors: mediaErrors };

  let scheduledAt: Date | null = null;
  if (String(form.get('when') ?? 'now') === 'later') {
    scheduledAt = new Date(String(form.get('scheduledAt') ?? ''));
    if (Number.isNaN(scheduledAt.getTime())) return { errors: [t.pickDateTime] };
    if (scheduledAt.getTime() < Date.now() - 60_000) return { errors: [t.scheduledInPast] };
  }

  const flowId = String(form.get('flowId') ?? '') || undefined;
  const input = {
    workspaceId: workspace.id,
    text,
    media,
    options: readOptions(form),
    variants: readVariants(form),
    ...(flowId ? { flowId } : { accountIds }),
    scheduledAt,
    locale,
  };
  const db = getDb();
  const result = postId ? await updatePost(db, postId, input) : await createPost(db, { ...input, authorId: user.id });
  if (!result.ok) return { errors: result.errors };
  await record({
    action: postId ? 'post.updated' : 'post.created',
    userId: user.id,
    workspaceId: workspace.id,
    target: excerpt(text),
    details: { scheduled: scheduledAt !== null },
  });
  revalidatePath('/posts');
  revalidatePath('/canvas');
  if (form.get('returnTo') === '/canvas') return { saved: Date.now() };
  redirect('/posts');
}

/** The composer's starting values for editing a post (or, with `asCopy`, posting it again). */
export async function loadPostAction(postId: string, asCopy = false): Promise<ComposerInitial | { error: string }> {
  const { workspace } = await requireSession();
  return (await loadComposerInitial(workspace.id, postId, asCopy)) ?? { error: (await getMessages(postsMessages)).cannotEditAnymore };
}

export async function retryPostAction(postId: string): Promise<void> {
  const { user, workspace } = await requireSession();
  const db = getDb();
  const post = await db.query.posts.findFirst({ where: (p, { and, eq }) => and(eq(p.id, postId), eq(p.workspaceId, workspace.id)) });
  if (post && (await retryPost(db, workspace.id, postId))) {
    await record({ action: 'post.retried', userId: user.id, workspaceId: workspace.id, target: excerpt(post.text) });
  }
  revalidatePath('/posts');
  revalidatePath('/canvas');
}

/** Moves a scheduled post to another time (calendar drag and drop). */
/** Posts for the calendar's current view (the browser knows the viewer's time zone, so it picks the range). */
export async function loadCalendarAction(fromIso: string, toIso: string): Promise<CalendarData | { error: string }> {
  const { workspace } = await requireSession();
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const span = to.getTime() - from.getTime();
  if (!(span > 0 && span <= MAX_CALENDAR_SPAN)) return { error: (await getMessages(postsMessages)).calendarLoadFailed };
  return loadCalendar(workspace.id, from, to);
}

export async function reschedulePostAction(postId: string, iso: string): Promise<{ error?: string }> {
  const { user, workspace } = await requireSession();
  const [locale, t] = await Promise.all([getLocale(), getMessages(postsMessages)]);
  const at = new Date(iso);
  if (at.getTime() < Date.now() - 60_000) return { error: t.pickFuture };
  const db = getDb();
  const result = await reschedulePost(db, workspace.id, postId, at, locale);
  if (!result.ok) return { error: result.errors[0] };
  const post = await db.query.posts.findFirst({ where: (p, { eq }) => eq(p.id, postId) });
  await record({ action: 'post.updated', userId: user.id, workspaceId: workspace.id, target: excerpt(post?.text ?? ''), details: { rescheduled: true } });
  revalidatePath('/posts');
  revalidatePath('/canvas');
  return {};
}

export async function removePost(form: FormData) {
  const { user, workspace } = await requireSession();
  const text = await deletePost(getDb(), workspace.id, String(form.get('postId')));
  if (text !== undefined) await record({ action: 'post.deleted', userId: user.id, workspaceId: workspace.id, target: excerpt(text) });
  revalidatePath('/posts');
  revalidatePath('/canvas');
}
