import Link from 'next/link';
import { listPosts } from '@postwerk/core';
import { getDb, type PostStatus } from '@postwerk/db';
import { LocalTime } from '@/components/local-time';
import { providerLabels } from '@/lib/platforms';
import { requireSession } from '@/lib/session';
import { removePost } from './actions';

export const metadata = { title: 'Posts · Postwerk' };

const statusLabels: Record<PostStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  publishing: 'Publishing',
  published: 'Published',
  partial: 'Partly published',
  failed: 'Failed',
};

export default async function PostsPage() {
  const { workspace } = await requireSession();
  const posts = await listPosts(getDb(), workspace.id);

  return (
    <div className="stack-lg">
      <div className="row">
        <h1 className="grow">Posts</h1>
        <Link href="/posts" className="button secondary">Refresh</Link>
        <Link href="/posts/new" className="button">New post</Link>
      </div>

      {posts.length === 0 ? (
        <div className="card">
          <p className="muted">Nothing here yet. Write your first post.</p>
        </div>
      ) : (
        <ul className="stack">
          {posts.map((post) => (
            <li key={post.id} className="card stack">
              <div className="row">
                <span className={`badge status-${post.status}`}>{statusLabels[post.status]}</span>
                <span className="muted grow">{post.scheduledAt && <LocalTime iso={post.scheduledAt.toISOString()} />}</span>
                {(post.status === 'scheduled' || post.status === 'draft' || post.status === 'failed') && (
                  <form action={removePost}>
                    <input type="hidden" name="postId" value={post.id} />
                    <button type="submit" className="secondary">Delete</button>
                  </form>
                )}
              </div>
              <p className="post-text">{post.text}</p>
              {post.media.length > 0 && (
                <ul className="chips">
                  {post.media.map((item) => (
                    <li key={item.url}>
                      <a href={item.url} target="_blank" rel="noreferrer">{item.kind === 'video' ? 'Video' : 'Image'}</a>
                    </li>
                  ))}
                </ul>
              )}
              <ul className="targets">
                {post.targets.map((target) => (
                  <li key={target.id}>
                    <span className={`badge badge-${target.account.provider}`}>{providerLabels[target.account.provider]}</span>{' '}
                    {target.account.handle}
                    {Object.keys(target.options).length > 0 && <span className="muted"> ({Object.values(target.options).join(' · ')})</span>} —{' '}
                    {target.status === 'published' && target.remoteUrl ? (
                      <a href={target.remoteUrl} target="_blank" rel="noreferrer">published</a>
                    ) : (
                      <span className={target.status === 'failed' ? 'error' : 'muted'}>{target.status}</span>
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
