import { and, eq } from 'drizzle-orm';
import { posts, users, workspaceMembers, type Database } from '@postwerk/db';
import { getProviderInfo } from '@postwerk/providers';
import { isLocale } from './i18n';
import { trySendMail } from './mail';
import { postFailedMail } from './mail-templates';
import type { FinishedPost } from './publisher';

const excerpt = (text: string) => (text.length > 120 ? `${text.slice(0, 119)}…` : text) || '(media only)';

/**
 * Emails the author when a post failed or went out only partly. Authors can
 * turn this off; posts without an author (deleted user) go to the owners.
 */
export async function notifyPostProblem(db: Database, post: FinishedPost, appUrl: string): Promise<number> {
  if (post.status === 'published') return 0;
  const row = await db.query.posts.findFirst({ where: eq(posts.id, post.postId), with: { targets: { with: { account: true } } } });
  if (!row) return 0;

  const recipients = row.authorId
    ? await db.select({ email: users.email, name: users.name, notify: users.notifyFailures, locale: users.locale }).from(users).where(eq(users.id, row.authorId))
    : await db
        .select({ email: users.email, name: users.name, notify: users.notifyFailures, locale: users.locale })
        .from(workspaceMembers)
        .innerJoin(users, eq(users.id, workspaceMembers.userId))
        .where(and(eq(workspaceMembers.workspaceId, row.workspaceId), eq(workspaceMembers.role, 'owner')));

  const failures = row.targets
    .filter((target) => target.status === 'failed')
    .map((target) => ({ account: `${target.account.handle} (${getProviderInfo(target.account.provider).name})`, error: target.lastError ?? 'Unknown error' }));
  let sent = 0;
  for (const recipient of recipients.filter((candidate) => candidate.notify)) {
    const mail = postFailedMail(recipient.email, {
      name: recipient.name,
      excerpt: excerpt(row.text),
      partial: post.status === 'partial',
      failures,
      url: `${appUrl}/canvas#n=panel:posts`,
      settingsUrl: `${appUrl}/account`,
    }, isLocale(recipient.locale) ? recipient.locale : 'en');
    if (await trySendMail(mail)) sent++;
  }
  return sent;
}
