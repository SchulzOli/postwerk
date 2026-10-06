import { asc, eq } from 'drizzle-orm';
import { bridgeFor, bridgeSetup, isBlueskyOAuthAvailable, isProviderAvailable, networkRoute } from '@postwerk/core';
import { getDb, socialAccounts } from '@postwerk/db';
import { bridges, getProvider, isBridgeId, localizeFields, localizeInfo, providerInfos } from '@postwerk/providers';
import { BlueskyConnect } from '@/components/bluesky-connect';
import { ConnectForm } from '@/components/connect-form';
import { appUrl } from '@/lib/env';
import { getLocale, getMessages } from '@/lib/i18n-server';
import { providerLabels } from '@/lib/platforms';
import { requireSession } from '@/lib/session';
import { commonMessages } from '@/messages/common';
import { networksMessages } from '@/messages/networks';
import { connectMastodon, connectWithForm, disconnectAccount, startBridgeConnectAction, startOAuth } from './actions';

export async function generateMetadata() {
  const [t, common] = await Promise.all([getMessages(networksMessages), getMessages(commonMessages)]);
  return { title: common.title(t.pageTitle) };
}

export default async function AccountsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { workspace, role } = await requireSession();
  const { connected, error } = await searchParams;
  const locale = await getLocale();
  const [t, common] = await Promise.all([getMessages(networksMessages), getMessages(commonMessages)]);
  const accounts = await getDb().query.socialAccounts.findMany({
    where: eq(socialAccounts.workspaceId, workspace.id),
    orderBy: [asc(socialAccounts.provider), asc(socialAccounts.handle)],
  });
  const canManage = role !== 'editor';
  const networks = providerInfos.filter((info) => info.id !== 'sandbox' || isProviderAvailable('sandbox')).map((info) => localizeInfo(info, locale));
  const available = networks.filter((info) => networkRoute(info.id) !== 'unavailable');
  const needsSetup = networks.filter((info) => networkRoute(info.id) === 'unavailable');
  const bridgeName = bridgeSetup()?.bridge.name ?? '';

  return (
    <div className="stack-lg">
      <h1>{t.pageTitle}</h1>
      {connected && <p className="success" role="status">{t.connectedNotice(connected)}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      <section className="card">
        <h2>{t.connected}</h2>
        {accounts.length === 0 ? (
          <p className="muted">{t.noAccounts}</p>
        ) : (
          <ul className="list">
            {accounts.map((account) => {
              const via = isBridgeId(account.bridge) ? bridges[account.bridge].name : null;
              return (
                <li key={account.id} className="row">
                  {account.avatarUrl ? <img src={account.avatarUrl} alt="" className="avatar" /> : <span className="avatar" />}
                  <div className="grow">
                    <strong>{account.displayName ?? account.handle}</strong>
                    <div className="muted">
                      <span className={`badge badge-${account.provider}`}>{providerLabels[account.provider]}</span> {account.handle}
                      {via && ` · ${t.via(via)}`}
                    </div>
                  </div>
                  {account.status === 'needs_reauth' && <span className="badge badge-warn">{common.reconnectNeeded}</span>}
                  {canManage && via && account.status === 'needs_reauth' && (
                    <form action={startBridgeConnectAction.bind(null, account.provider, account.id)}>
                      <button type="submit">{t.reconnect}</button>
                    </form>
                  )}
                  {canManage && (
                    <form action={disconnectAccount}>
                      <input type="hidden" name="accountId" value={account.id} />
                      <input type="hidden" name="returnTo" value="/accounts" />
                      <button type="submit" className="secondary">{t.disconnect}</button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {canManage && (
        <>
          <h2>{t.connectNetwork}</h2>
          {bridgeName && available.some((info) => networkRoute(info.id) === 'bridge') && <p className="muted">{t.bridgeAbout(bridgeName)}</p>}
          <div className="grid">
            {available.map((info) => {
              const { connector } = getProvider(info.id);
              return (
                <section key={info.id} className="card">
                  <h2>{info.name}</h2>
                  <p className="muted">{info.description}</p>
                  {networkRoute(info.id) === 'bridge' ? (
                    <form action={startBridgeConnectAction.bind(null, info.id, undefined)} className="stack-sm">
                      <button type="submit">{t.continueTo(info.name)}</button>
                      <small className="muted">{t.via(bridgeName)}</small>
                    </form>
                  ) : (
                    <>
                    {connector.kind === 'mastodon' && (
                      <ConnectForm
                        action={connectMastodon}
                        submitLabel={t.continueTo('Mastodon')}
                        fields={[{ name: 'instance', label: t.mastodonServer, placeholder: 'mastodon.social' }]}
                      />
                    )}
                    {connector.kind === 'form' && (
                      <ConnectForm action={connectWithForm.bind(null, info.id)} submitLabel={t.connectNamed(info.name)} fields={localizeFields(info.id, connector.fields, locale)} />
                    )}
                    {connector.kind === 'atproto' && <BlueskyConnect fields={localizeFields(info.id, connector.fields, locale)} oauth={isBlueskyOAuthAvailable(appUrl)} />}
                    {connector.kind === 'oauth2' && (
                      <form action={startOAuth.bind(null, info.id)}>
                        <button type="submit">{t.continueTo(info.name)}</button>
                      </form>
                    )}
                    </>
                  )}
                </section>
              );
            })}
          </div>

          {needsSetup.length > 0 && (
            <details className="card">
              <summary>
                <strong>{t.moreNetworks(needsSetup.length)}</strong> <span className="muted">{t.needSetup}</span>
              </summary>
              <ul className="list setup-list">
                {needsSetup.map((info) => {
                  const bridge = bridgeFor(info.id);
                  return (
                    <li key={info.id} className="stack-sm">
                      <strong>{info.name}</strong>
                      <span className="muted">{info.setup.review}</span>
                      <span>
                        {t.envSet} <code>{info.setup.envPrefix}_CLIENT_ID</code> {t.envAnd} <code>{info.setup.envPrefix}_CLIENT_SECRET</code> ·{' '}
                        <a href={info.setup.docsUrl} target="_blank" rel="noreferrer">{t.developerDocs}</a>
                      </span>
                      {bridge && (
                        <span className="muted">
                          {t.orBridge(bridge.name).before}
                          <code>{bridge.env}</code>
                          {t.orBridge(bridge.name).after}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
