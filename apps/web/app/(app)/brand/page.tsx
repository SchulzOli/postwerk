import { findMedia, getBrandKit } from '@maas/core';
import { getDb } from '@maas/db';
import { BrandForm } from '@/components/brand-form';
import { getMessages } from '@/lib/i18n-server';
import { requireSession } from '@/lib/session';
import { brandMessages } from '@/messages/brand';
import { commonMessages } from '@/messages/common';

export async function generateMetadata() {
  const [t, common] = await Promise.all([getMessages(brandMessages), getMessages(commonMessages)]);
  return { title: common.title(t.pageTitle) };
}

export default async function BrandPage() {
  const { workspace, role } = await requireSession();
  const db = getDb();
  const [kit, t] = await Promise.all([getBrandKit(db, workspace), getMessages(brandMessages)]);
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
