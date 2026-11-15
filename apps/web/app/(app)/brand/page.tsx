import Link from 'next/link';
import { findMedia, getBrandKit, listMarkets, listProducts } from '@maas/core';
import { getDb } from '@maas/db';
import { BrandForm } from '@/components/brand-form';
import { getMessages } from '@/lib/i18n-server';
import { requireSession } from '@/lib/session';
import { brandMessages } from '@/messages/brand';
import { commonMessages } from '@/messages/common';
import { marketsMessages } from '@/messages/markets';

export async function generateMetadata() {
  const [t, common] = await Promise.all([getMessages(brandMessages), getMessages(commonMessages)]);
  return { title: common.title(t.pageTitle) };
}

export default async function BrandPage() {
  const { workspace, role } = await requireSession();
  const db = getDb();
  const [kit, t, m, markets, products] = await Promise.all([getBrandKit(db, workspace), getMessages(brandMessages), getMessages(marketsMessages), listMarkets(db, workspace.id), listProducts(db, workspace.id)]);
  const uploads = await findMedia(db, workspace.id, kit.mediaIds);
  const image = (id: string | null | undefined) => {
    const row = id ? uploads.get(id) : undefined;
    return row ? [{ id: row.id, url: `/media/${row.key}` }] : [];
  };
  const canEdit = role !== 'editor';
  return (
    <div className="stack-lg">
      <h1>{t.pageTitle}</h1>
      <p className="muted">{t.intro}</p>
      {!canEdit && <p className="muted">{t.readOnly}</p>}
      <section className="card stack">
        <h2>{m.brandCard}</h2>
        {products.length > 0 ? (
          <ul className="chips">
            {products.map((product) => (
              <li key={product.id}>
                <Link href={`/brand/products/${product.id}`}>{product.name}</Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{markets.length > 0 ? m.noProducts : m.brandCardIntro}</p>
        )}
        <Link href="/brand/markets" className="small-link">{m.manage}</Link>
      </section>
      <BrandForm
        kit={{
          companyName: kit.companyName,
          tagline: kit.tagline,
          description: kit.description,
          audience: kit.audience,
          tone: kit.tone,
          dos: kit.dos,
          donts: kit.donts,
          colors: kit.colors,
          font: kit.font,
          website: kit.website,
          email: kit.email,
          phone: kit.phone,
          address: kit.address,
          character: kit.character && {
            name: kit.character.name,
            role: kit.character.role,
            look: kit.character.look,
            personality: kit.character.personality,
            voice: kit.character.voice,
            catchphrase: kit.character.catchphrase,
            rules: kit.character.rules,
          },
        }}
        logo={image(kit.logoMediaId)}
        characterImages={(kit.character?.imageMediaIds ?? []).flatMap((id) => image(id))}
        canEdit={canEdit}
      />
    </div>
  );
}
