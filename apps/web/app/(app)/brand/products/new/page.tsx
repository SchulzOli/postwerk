import { notFound } from 'next/navigation';
import { listMarkets } from '@maas/core';
import { getDb } from '@maas/db';
import { getLocale, getMessages } from '@/lib/i18n-server';
import { requireAdmin } from '@/lib/session';
import { commonMessages } from '@/messages/common';
import { marketsMessages } from '@/messages/markets';
import { ProductPage } from '../product-page';

type Props = { searchParams: Promise<{ market?: string }> };

export async function generateMetadata() {
  const [t, common] = await Promise.all([getMessages(marketsMessages), getMessages(commonMessages)]);
  return { title: common.title(t.product) };
}

export default async function NewProductPage({ searchParams }: Props) {
  const { workspace } = await requireAdmin();
  const { market: marketId } = await searchParams;
  const [markets, t, locale] = await Promise.all([listMarkets(getDb(), workspace.id), getMessages(marketsMessages), getLocale()]);
  const market = markets.find((entry) => entry.id === marketId)?.manifest;
  if (!market) notFound();
  return (
    <ProductPage
      title={t.newProduct(market.product.name[locale])}
      product={{ marketId: market.id, marketName: market.name[locale], name: '', profile: {} }}
      market={market}
      locale={locale}
      canEdit
    />
  );
}
