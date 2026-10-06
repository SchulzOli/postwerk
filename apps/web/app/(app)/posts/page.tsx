import Link from 'next/link';
import { listPosts } from '@postwerk/core';
import { getDb } from '@postwerk/db';
import { LocalTime } from '@/components/local-time';
import { getMessages } from '@/lib/i18n-server';
import { providerLabels } from '@/lib/platforms';
import { canEdit, canPostAgain, canRetry } from '@/lib/post-status';
import { requireSession } from '@/lib/session';
import { commonMessages } from '@/messages/common';
import { postsMessages } from '@/messages/posts';
import { removePost, retryPostAction } from './actions';

export async function generateMetadata() {
  const [t, common] = await Promise.all([getMessages(postsMessages), getMessages(commonMessages)]);
  return { title: common.title(t.pageTitle) };
}

export default async function PostsPage() {
  const { workspace } = await requireSession();
  const [posts, t, common] = await Promise.all([listPosts(getDb(), workspace.id), getMessages(postsMessages), getMessages(commonMessages)]);

  return (
    <div className="stack-lg">
      <div className="row">
        <h1 className="grow">{t.pageTitle}</h1>
        <Link href="/posts" className="button secondary">{t.refresh}</Link>
        <Link href="/posts/new" className="button">{t.newPost}</Link>
      </div>

      {posts.length === 0 ? (
        <div className="card">
          <p className="muted">{t.empty}</p>
        </div>
      ) : (
        <ul className="stack">
          {posts.map((post) => (
            <li key={post.id} className="card stack">
              <div className="row">
                <span className={`badge status-${post.status}`}>{common.status[post.status]}</span>
                <span className="muted grow">{post.scheduledAt && <LocalTime iso={post.scheduledAt.toISOString()} />}</span>
                {canEdit(post.status) && (
                  <Link href={`/posts/${post.id}/edit`} className="button secondary">{common.edit}</Link>
                )}
                {canRetry(post.status) && (
                  <form action={retryPostAction.bind(null, post.id)}>
                    <button type="submit" className="secondary">{t.retryFailed}</button>
                  </form>
                )}
                {canPostAgain(post.status) && (
                  <Link href={`/posts/new?from=${post.id}`} className="button secondary">{t.postAgain}</Link>
                )}
                {canEdit(post.status) && (
                  <form action={removePost}>
                    <input type="hidden" name="postId" value={post.id} />
                    <button type="submit" className="secondary">{common.delete}</button>
                  </form>
                )}
              </div>
              <p className="post-text">{post.text}</p>
              {post.media.length > 0 && (
                <div className="post-media">
                  {post.media.map((item) => (
                    <a key={item.url} href={item.url} target="_blank" rel="noreferrer" title={item.altText}>
                      {item.kind === 'video' ? <video src={item.url} muted preload="metadata" /> : <img src={item.url} alt={item.altText ?? ''} loading="lazy" />}
                    </a>
                  ))}
                </div>
              )}
              <ul className="targets">
                {post.targets.map((target) => (
                  <li key={target.id}>
                    <span className={`badge badge-${target.account.provider}`}>{providerLabels[target.account.provider]}</span>{' '}
                    {target.account.handle}
                    {Object.keys(target.options).length > 0 && <span className="muted"> ({Object.values(target.options).join(' · ')})</span>} —{' '}
                    {target.status === 'published' && target.remoteUrl ? (
                      <a href={target.remoteUrl} target="_blank" rel="noreferrer">{common.targetStatus.published}</a>
                    ) : (
                      <span className={target.status === 'failed' ? 'error' : 'muted'}>{common.targetStatus[target.status]}</span>
                    )}
                    {target.lastError && target.status !== 'published' && <small className="muted"> ({target.lastError})</small>}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
