import Link from 'next/link';
import { Composer } from '@/components/composer';
import { loadComposerChoices, loadComposerInitial } from '@/lib/compose';
import { requireSession } from '@/lib/session';
import { submitPost } from '../../actions';

export const metadata = { title: 'Edit post · Postwerk' };

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { workspace } = await requireSession();
  const { id } = await params;
  const [{ accounts, flows }, initial] = await Promise.all([loadComposerChoices(workspace.id), loadComposerInitial(workspace.id, id)]);

  if (!initial) {
    return (
      <div className="card stack">
        <h1>This post cannot be edited</h1>
        <p className="muted">It is already going out, or it was deleted.</p>
        <Link href="/posts">Back to posts</Link>
      </div>
    );
  }
  return (
    <div className="stack-lg">
      <div className="row">
        <h1 className="grow">Edit post</h1>
        <Link href="/posts" className="button secondary">Cancel</Link>
      </div>
      <Composer accounts={accounts} flows={flows} action={submitPost} initial={initial} />
    </div>
  );
}
