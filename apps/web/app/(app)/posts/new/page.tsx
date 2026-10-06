import Link from 'next/link';
import { Composer } from '@/components/composer';
import { loadComposerChoices, loadComposerInitial } from '@/lib/compose';
import { getMessages } from '@/lib/i18n-server';
import { requireSession } from '@/lib/session';
import { commonMessages } from '@/messages/common';
import { postsMessages } from '@/messages/posts';
import { submitPost } from '../actions';

export async function generateMetadata() {
  const [t, common] = await Promise.all([getMessages(postsMessages), getMessages(commonMessages)]);
  return { title: common.title(t.newPost) };
}

export default async function NewPostPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { workspace } = await requireSession();
  const { from, at } = await searchParams;
  // Planned from the calendar: start scheduled for that time.
  const startAt = at && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : undefined;
  const [{ accounts, flows }, initial, t] = await Promise.all([
    loadComposerChoices(workspace.id),
    // "Post again" starts from an earlier post.
    from ? loadComposerInitial(workspace.id, from, true) : undefined,
    getMessages(postsMessages),
  ]);

  if (accounts.length === 0) {
    return (
      <div className="card stack">
        <h1>{t.newPost}</h1>
        <p>{t.connectFirst}</p>
        <Link href="/accounts" className="button">{t.connectAccount}</Link>
      </div>
    );
  }

  return (
    <div className="stack-lg">
      <h1>{t.newPost}</h1>
      <Composer accounts={accounts} flows={flows} action={submitPost} initial={initial} scheduledAt={startAt} />
    </div>
  );
}
