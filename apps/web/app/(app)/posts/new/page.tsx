import Link from 'next/link';
import { Composer } from '@/components/composer';
import { loadComposerChoices, loadComposerInitial } from '@/lib/compose';
import { requireSession } from '@/lib/session';
import { submitPost } from '../actions';

export const metadata = { title: 'New post · Postwerk' };

export default async function NewPostPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { workspace } = await requireSession();
  const { from, at } = await searchParams;
  // Planned from the calendar: start scheduled for that time.
  const startAt = at && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : undefined;
  const [{ accounts, flows }, initial] = await Promise.all([
    loadComposerChoices(workspace.id),
    // "Post again" starts from an earlier post.
    from ? loadComposerInitial(workspace.id, from, true) : undefined,
  ]);

  if (accounts.length === 0) {
    return (
      <div className="card stack">
        <h1>New post</h1>
        <p>Connect a social account first.</p>
        <Link href="/accounts" className="button">Connect an account</Link>
      </div>
    );
  }

  return (
    <div className="stack-lg">
      <h1>New post</h1>
      <Composer accounts={accounts} flows={flows} action={submitPost} initial={initial} scheduledAt={startAt} />
    </div>
  );
}
