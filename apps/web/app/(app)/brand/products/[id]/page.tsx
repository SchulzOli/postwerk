import { notFound } from 'next/navigation';
import { getProduct, installedMarket, productCampaignCount } from '@maas/core';
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
  const [market, used, t, locale] = await Promise.all([
    installedMarket(db, workspace.id, product.marketId),
    productCampaignCount(db, workspace.id, product.id),
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
    >
      <p className="muted small">{t.campaigns(used)}</p>
    </ProductPage>
  );
}
