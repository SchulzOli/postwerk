import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { Composer, type ComposerAccount } from '@/components/composer';
import { getDb, socialAccounts } from '@postwerk/db';
import { requireSession } from '@/lib/session';
import { submitPost } from '../actions';

export const metadata = { title: 'New post · Postwerk' };

export default async function NewPostPage() {
  const { workspace } = await requireSession();
  const accounts = await getDb().query.socialAccounts.findMany({
    where: eq(socialAccounts.workspaceId, workspace.id),
    orderBy: [asc(socialAccounts.provider), asc(socialAccounts.handle)],
  });

  if (accounts.length === 0) {
    return (
      <div className="card stack">
        <h1>New post</h1>
        <p>Connect a social account first.</p>
        <Link href="/accounts" className="button">Connect an account</Link>
      </div>
    );
  }

  const composerAccounts: ComposerAccount[] = accounts.map((account) => ({
    id: account.id,
    handle: account.handle,
    provider: account.provider,
    maxLength: account.maxLength,
    disabledReason: account.status === 'needs_reauth' ? 'Reconnect needed' : undefined,
  }));

  return (
    <div className="stack-lg">
      <h1>New post</h1>
      <Composer accounts={composerAccounts} action={submitPost} />
    </div>
  );
}
