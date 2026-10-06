import { asc, eq } from 'drizzle-orm';
import { isBlueskyOAuthAvailable, isProviderAvailable } from '@postwerk/core';
import { getDb, socialAccounts } from '@postwerk/db';
import { getProvider, providerInfos } from '@postwerk/providers';
import { BlueskyConnect } from '@/components/bluesky-connect';
import { ConnectForm } from '@/components/connect-form';
import { appUrl } from '@/lib/env';
import { providerLabels } from '@/lib/platforms';
import { requireSession } from '@/lib/session';
import { connectMastodon, connectWithForm, disconnectAccount, startOAuth } from './actions';

export const metadata = { title: 'Accounts · Postwerk' };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { workspace, role } = await requireSession();
  const { connected, error } = await searchParams;
  const accounts = await getDb().query.socialAccounts.findMany({
    where: eq(socialAccounts.workspaceId, workspace.id),
    orderBy: [asc(socialAccounts.provider), asc(socialAccounts.handle)],
  });
  const canManage = role !== 'editor';
  const networks = providerInfos.filter((info) => info.id !== 'sandbox' || isProviderAvailable('sandbox'));
  const available = networks.filter((info) => isProviderAvailable(info.id));
  const needsSetup = networks.filter((info) => !isProviderAvailable(info.id));

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
        <>
          <h2>Connect a network</h2>
          <div className="grid">
            {available.map((info) => {
              const { connector } = getProvider(info.id);
              return (
                <section key={info.id} className="card">
                  <h2>{info.name}</h2>
                  <p className="muted">{info.description}</p>
                  {connector.kind === 'mastodon' && (
                    <ConnectForm
                      action={connectMastodon}
                      submitLabel="Continue to Mastodon"
                      fields={[{ name: 'instance', label: 'Server', placeholder: 'mastodon.social' }]}
                    />
                  )}
                  {connector.kind === 'form' && (
                    <ConnectForm action={connectWithForm.bind(null, info.id)} submitLabel={`Connect ${info.name}`} fields={connector.fields} />
                  )}
                  {connector.kind === 'atproto' && <BlueskyConnect fields={connector.fields} oauth={isBlueskyOAuthAvailable(appUrl)} />}
                  {connector.kind === 'oauth2' && (
                    <form action={startOAuth.bind(null, info.id)}>
                      <button type="submit">Continue to {info.name}</button>
                    </form>
                  )}
                </section>
              );
            })}
          </div>

          {needsSetup.length > 0 && (
            <details className="card">
              <summary>
                <strong>{needsSetup.length} more networks</strong> <span className="muted">need a one-time setup by the server admin</span>
              </summary>
              <ul className="list setup-list">
                {needsSetup.map((info) => (
                  <li key={info.id} className="stack-sm">
                    <strong>{info.name}</strong>
                    <span className="muted">{info.setup.review}</span>
                    <span>
                      Set <code>{info.setup.envPrefix}_CLIENT_ID</code> and <code>{info.setup.envPrefix}_CLIENT_SECRET</code> ·{' '}
                      <a href={info.setup.docsUrl} target="_blank" rel="noreferrer">Developer docs</a>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
