import 'server-only';
import Link from 'next/link';
import { MAX_FEATURES, type MarketManifest } from '@maas/core';
import type { Locale } from '@maas/core/i18n';
import { ProductForm, type MarketField, type ProductFormData } from '@/components/market-forms';
import { getMessages } from '@/lib/i18n-server';
import { marketsMessages } from '@/messages/markets';

/** A market's own profile fields with their texts in the UI language. */
export function marketFields(market: MarketManifest | undefined, locale: Locale): MarketField[] {
  return (market?.product.fields ?? []).map((field) => ({
    id: field.id,
    label: field.label[locale],
    hint: field.hint?.[locale],
    type: field.type,
    options: field.options?.map((option) => ({ id: option.id, label: option.label[locale] })),
    required: field.required,
  }));
}

/** The product page for a new or an existing product. */
export async function ProductPage({ title, product, market, locale, canEdit, children }: { title: string; product: ProductFormData; market: MarketManifest | undefined; locale: Locale; canEdit: boolean; children?: React.ReactNode }) {
  const t = await getMessages(marketsMessages);
  return (
    <div className="stack-lg">
      <div className="stack-sm">
        <Link href="/brand/markets" className="small-link">← {t.pageTitle}</Link>
        <div className="row">
          <h1 className="grow">{title}</h1>
          <span className="badge">{market ? market.product.name[locale] : product.marketId}</span>
        </div>
      </div>
      {!market && <p className="warn-text">{t.marketGone}</p>}
      {!canEdit && <p className="muted">{t.readOnly}</p>}
      {children}
      <ProductForm product={product} fields={marketFields(market, locale)} maxFeatures={MAX_FEATURES} canEdit={canEdit && Boolean(market)} />
    </div>
  );
}
