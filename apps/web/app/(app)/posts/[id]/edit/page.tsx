import Link from 'next/link';
import { Composer } from '@/components/composer';
import { loadComposerChoices, loadComposerInitial } from '@/lib/compose';
import { getMessages } from '@/lib/i18n-server';
import { requireSession } from '@/lib/session';
import { commonMessages } from '@/messages/common';
import { postsMessages } from '@/messages/posts';
import { submitPost } from '../../actions';

export async function generateMetadata() {
  const [t, common] = await Promise.all([getMessages(postsMessages), getMessages(commonMessages)]);
  return { title: common.title(t.editPost) };
}

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { workspace } = await requireSession();
  const { id } = await params;
  const [{ accounts, flows }, initial, t, common] = await Promise.all([
    loadComposerChoices(workspace.id),
    loadComposerInitial(workspace.id, id),
    getMessages(postsMessages),
    getMessages(commonMessages),
  ]);

  if (!initial) {
    return (
      <div className="card stack">
        <h1>{t.cannotEdit}</h1>
        <p className="muted">{t.cannotEditWhy}</p>
        <Link href="/posts">{t.backToPosts}</Link>
      </div>
    );
  }
  return (
    <div className="stack-lg">
      <div className="row">
        <h1 className="grow">{t.editPost}</h1>
        <Link href="/posts" className="button secondary">{common.cancel}</Link>
      </div>
      <Composer accounts={accounts} flows={flows} action={submitPost} initial={initial} />
    </div>
  );
}
