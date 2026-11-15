import Link from 'next/link';
import { builtinMarkets, ensureConnection, listMarkets, listProducts } from '@maas/core';
import { DOCS_URL } from '@maas/providers';
import { getDb } from '@maas/db';
import { DownloadMarketButton, InstallBuiltinMarketButton, InstallMarketForm, PartnerCenterCard, UninstallMarketButton, type PartnerCenterData } from '@/components/market-forms';
import { appUrl } from '@/lib/env';
import { getLocale, getMessages } from '@/lib/i18n-server';
import { requireSession } from '@/lib/session';
import { commonMessages } from '@/messages/common';
import { marketsMessages } from '@/messages/markets';

export async function generateMetadata() {
  const [t, common] = await Promise.all([getMessages(marketsMessages), getMessages(commonMessages)]);
  return { title: common.title(t.pageTitle) };
}

export default async function MarketsPage() {
  const { workspace, role } = await requireSession();
  const db = getDb();
  const [markets, products, t, locale] = await Promise.all([listMarkets(db, workspace.id), listProducts(db, workspace.id), getMessages(marketsMessages), getLocale()]);
  const canManage = role !== 'editor';
  const installed = new Set(markets.map((market) => market.id));
  const available = builtinMarkets.filter((market) => !installed.has(market.id));
  const productsOf = (marketId: string) => products.filter((product) => product.marketId === marketId);
  const orphans = products.filter((product) => !installed.has(product.marketId));
  // The lead address is a secret: only owners and admins see it.
  const partnerCenter: PartnerCenterData[] = canManage
    ? await Promise.all(
        markets
          .filter((market) => market.manifest.marketplace.integration === 'partner-center')
          .map(async (market) => {
            const connection = await ensureConnection(db, workspace.id, market.id);
            const when = connection.lastSyncAt && new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(connection.lastSyncAt);
            return {
              marketId: market.id,
              leadUrl: `${appUrl}/api/marketplace/leads/${connection.leadToken}`,
              connected: Boolean(connection.credentials),
              lastSync: when || null,
              lastError: connection.lastSyncError ? (t.errors[connection.lastSyncError] ?? connection.lastSyncError) : null,
            };
          }),
      )
    : [];

  return (
    <div className="stack-lg">
      <div className="stack-sm">
        <Link href="/brand" className="small-link">{t.back}</Link>
        <h1>{t.pageTitle}</h1>
      </div>
      <p className="muted">{t.intro}</p>

      <section className="card stack">
        <h2>{t.installed}</h2>
        {markets.length === 0 ? (
          <p className="muted">{t.noneInstalled}</p>
        ) : (
          <ul className="list">
            {markets.map(({ id, builtin, manifest }) => (
              <li key={id} className="stack-sm">
                <div className="row">
                  <strong className="grow">{manifest.name[locale]}</strong>
                  <span className="badge">{builtin ? t.builtIn : t.fromFile}</span>
                  {canManage && !builtin && <DownloadMarketButton manifest={manifest} />}
                  {canManage && <UninstallMarketButton marketId={id} name={manifest.name[locale]} />}
                </div>
                <span className="muted small">
                  {t.summary({ marketplace: manifest.marketplace.name, products: productsOf(id).length, templates: manifest.templates.length, version: manifest.version, author: manifest.author })}
                </span>
                <span className="small">{manifest.description[locale]}</span>
                <ul className="stack-sm">
                  {productsOf(id).map((product) => (
                    <li key={product.id}>
                      <Link href={`/brand/products/${product.id}`}>{product.name}</Link>
                    </li>
                  ))}
                </ul>
                {canManage && (
                  <Link href={`/brand/products/new?market=${id}`} className="button secondary small align-start">
                    {t.addProduct(manifest.product.name[locale])}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
        {orphans.length > 0 && (
          <div className="stack-sm">
            <small className="muted">{t.marketGone}</small>
            <ul className="stack-sm">
              {orphans.map((product) => (
                <li key={product.id}>
                  <Link href={`/brand/products/${product.id}`}>{product.name}</Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {partnerCenter.map((data) => (
        <PartnerCenterCard key={data.marketId} data={data} canManage={canManage} />
      ))}

      {available.length > 0 && (
        <section className="card stack">
          <h2>{t.available}</h2>
          <ul className="list">
            {available.map((market) => (
              <li key={market.id} className="stack-sm">
                <div className="row">
                  <strong className="grow">{market.name[locale]}</strong>
                  {canManage && <InstallBuiltinMarketButton marketId={market.id} />}
                </div>
                <span className="muted small">{market.marketplace.name}</span>
                <span className="small">{market.description[locale]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canManage ? <InstallMarketForm docsUrl={`${DOCS_URL}/markets`} /> : <p className="muted">{t.adminsOnly}</p>}
    </div>
  );
}
