import { asc, eq } from 'drizzle-orm';
import { ConnectForm } from '@/components/connect-form';
import { getDb, socialAccounts } from '@postwerk/db';
import { sandboxEnabled } from '@/lib/env';
import { providerLabels, upcoming } from '@/lib/platforms';
import { requireSession } from '@/lib/session';
import { connectBluesky, connectMastodon, connectSandbox, disconnectAccount } from './actions';

export const metadata = { title: 'Accounts · Postwerk' };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { workspace, role } = await requireSession();
  const { connected, error } = await searchParams;
  const accounts = await getDb().query.socialAccounts.findMany({
    where: eq(socialAccounts.workspaceId, workspace.id),
    orderBy: [asc(socialAccounts.provider), asc(socialAccounts.handle)],
  });
  const canManage = role !== 'editor';

  return (
    <div className="stack-lg">
      <h1>Accounts</h1>
      {connected && <p className="success" role="status">Connected {connected}.</p>}
      {error && <p className="error" role="alert">{error}</p>}

      <section className="card">
        <h2>Connected</h2>
        {accounts.length === 0 ? (
          <p className="muted">No accounts yet. Connect one below — it only takes a minute.</p>
        ) : (
          <ul className="list">
            {accounts.map((account) => (
              <li key={account.id} className="row">
                {account.avatarUrl ? <img src={account.avatarUrl} alt="" className="avatar" /> : <span className="avatar" />}
                <div className="grow">
                  <strong>{account.displayName ?? account.handle}</strong>
                  <div className="muted">
                    <span className={`badge badge-${account.provider}`}>{providerLabels[account.provider]}</span> {account.handle}
                  </div>
                </div>
                {account.status === 'needs_reauth' && <span className="badge badge-warn">Reconnect needed</span>}
                {canManage && (
                  <form action={disconnectAccount}>
                    <input type="hidden" name="accountId" value={account.id} />
                    <button type="submit" className="secondary">Disconnect</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManage && (
        <div className="grid">
          <section className="card">
            <h2>Mastodon</h2>
            <p className="muted">Enter your server and approve access there. No developer setup needed.</p>
            <ConnectForm
              action={connectMastodon}
              submitLabel="Continue to Mastodon"
              fields={[{ name: 'instance', label: 'Server', placeholder: 'mastodon.social' }]}
            />
          </section>

          <section className="card">
            <h2>Bluesky</h2>
            <p className="muted">Sign in with an app password so your main password stays private.</p>
            <ConnectForm
              action={connectBluesky}
              submitLabel="Connect Bluesky"
              fields={[
                { name: 'handle', label: 'Handle', placeholder: 'you.bsky.social' },
                {
                  name: 'appPassword',
                  label: 'App password',
                  type: 'password',
                  placeholder: 'xxxx-xxxx-xxxx-xxxx',
                  hint: (
                    <>
                      Create one at{' '}
                      <a href="https://bsky.app/settings/app-passwords" target="_blank" rel="noreferrer">
                        Settings → App passwords
                      </a>
                      .
                    </>
                  ),
                },
              ]}
            />
          </section>

          {sandboxEnabled && (
            <section className="card">
              <h2>Sandbox</h2>
              <p className="muted">A fake network for trying things out. Add #fail or #flaky to a post to simulate errors.</p>
              <ConnectForm action={connectSandbox} submitLabel="Add sandbox account" fields={[{ name: 'name', label: 'Name', placeholder: 'test' }]} />
            </section>
          )}

          <section className="card">
            <h2>Coming soon</h2>
            <ul className="chips">
              {upcoming.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
