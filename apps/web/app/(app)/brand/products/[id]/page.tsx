import { notFound } from 'next/navigation';
import { getProduct, installedMarket, listLeads, productCampaignCount } from '@maas/core';
import { DeleteLeadButton, DeleteLeadsButton } from '@/components/market-forms';
import { LocalTime } from '@/components/local-time';
import { getDb } from '@maas/db';
import { getLocale, getMessages } from '@/lib/i18n-server';
import { requireSession } from '@/lib/session';
import { commonMessages } from '@/messages/common';
import { marketsMessages } from '@/messages/markets';
import { ProductPage } from '../product-page';

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(id: string) {
  const { workspace } = await requireSession();
  return UUID.test(id) ? getProduct(getDb(), workspace.id, id) : null;
}

export async function generateMetadata({ params }: Props) {
  const [product, t, common] = await Promise.all([load((await params).id), getMessages(marketsMessages), getMessages(commonMessages)]);
  return { title: common.title(product?.name ?? t.product) };
}

export default async function ProductRoute({ params }: Props) {
  const { workspace, role } = await requireSession();
  const product = await load((await params).id);
  if (!product) notFound();
  const db = getDb();
  const canManage = role !== 'editor';
  const [market, used, leads, t, locale] = await Promise.all([
    installedMarket(db, workspace.id, product.marketId),
    productCampaignCount(db, workspace.id, product.id),
    canManage ? listLeads(db, workspace.id, { productId: product.id }) : [],
    getMessages(marketsMessages),
    getLocale(),
  ]);
  return (
    <ProductPage
      title={product.name}
      product={{ id: product.id, marketId: product.marketId, marketName: market?.name[locale] ?? product.marketId, name: product.name, profile: product.profile }}
      market={market}
      locale={locale}
      canEdit={role !== 'editor'}
      footer={
        market?.marketplace.integration && (
          <section className="card stack">
            <h2>{t.leads}</h2>
            {canManage ? (
              <>
                <p className="muted">{t.leadsIntro}</p>
                {leads.length === 0 ? (
                  <p className="muted">{t.noLeads}</p>
                ) : (
                  <>
                    <ul className="list">
                      {leads.map((lead) => (
                        <li key={lead.id} className="row">
                          <span className="grow stack-sm">
                            <span>
                              <strong>{[lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.email || '–'}</strong>
                              {lead.company && <> · {lead.company}</>}
                              {lead.title && <span className="muted"> · {lead.title}</span>}
                            </span>
                            <span className="muted small">
                              {t.actions[lead.action] ?? lead.action} · <LocalTime iso={lead.receivedAt.toISOString()} />
                              {lead.country && <> · {lead.country}</>}
                              {lead.email && (
                                <>
                                  {' '}
                                  · <a href={`mailto:${lead.email}`}>{lead.email}</a>
                                </>
                              )}
                              {lead.phone && <> · {lead.phone}</>}
                            </span>
                            {lead.description && <span className="small">{lead.description}</span>}
                          </span>
                          <DeleteLeadButton productId={product.id} leadId={lead.id} />
                        </li>
                      ))}
                    </ul>
                    <DeleteLeadsButton productId={product.id} />
                  </>
                )}
              </>
            ) : (
              <p className="muted">{t.adminsSeeLeads}</p>
            )}
          </section>
        )
      }
    >
      <p className="muted small">{t.campaigns(used)}</p>
    </ProductPage>
  );
}
