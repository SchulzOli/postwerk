'use client';

import { useActionState, useState } from 'react';
import type { BrandCharacter, BrandColors } from '@maas/db/types';
import { saveBrandKitAction, type BrandState } from '@/app/(app)/brand/actions';
import { useMessages } from '@/lib/i18n';
import { brandMessages } from '@/messages/brand';
import { ImageField, type StoredImage } from './image-field';

export interface BrandFormData {
  companyName: string;
  tagline: string;
  description: string;
  audience: string;
  tone: string;
  dos: string;
  donts: string;
  colors: BrandColors;
  font: string;
  website: string;
  email: string;
  phone: string;
  address: string;
  character: Omit<BrandCharacter, 'imageMediaIds'> | null;
}

const MAX_PICTURES = 6;
/** Colors in a fixed order (the database keeps object keys in its own order). */
const COLOR_KEYS: (keyof BrandColors)[] = ['primary', 'secondary', 'accent', 'text', 'background'];

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label>
      {label}
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

/** The brand kit form: company, voice, look and the brand character. */
export function BrandForm({ kit, logo, characterImages, canEdit }: { kit: BrandFormData; logo: StoredImage[]; characterImages: StoredImage[]; canEdit: boolean }) {
  const t = useMessages(brandMessages);
  const [state, action, pending] = useActionState<BrandState, FormData>(saveBrandKitAction, {});
  const [hasCharacter, setHasCharacter] = useState(Boolean(kit.character));
  const c = kit.character;
  return (
    <form action={action} className="stack-lg">
      <fieldset disabled={!canEdit} className="stack-lg">
        <section className="card stack">
          <h2>{t.company}</h2>
          <Field label={t.companyName}>
            <input name="companyName" defaultValue={kit.companyName} required maxLength={120} />
          </Field>
          <Field label={t.tagline}>
            <input name="tagline" defaultValue={kit.tagline} maxLength={160} />
          </Field>
          <Field label={t.description} hint={t.descriptionHint}>
            <textarea name="description" rows={3} defaultValue={kit.description} maxLength={2000} />
          </Field>
          <Field label={t.audience} hint={t.audienceHint}>
            <textarea name="audience" rows={2} defaultValue={kit.audience} maxLength={1000} />
          </Field>
          <div className="grid">
            <Field label={t.website}>
              <input name="website" type="url" placeholder="https://" defaultValue={kit.website} maxLength={300} />
            </Field>
            <Field label={t.email}>
              <input name="email" type="email" defaultValue={kit.email} maxLength={200} />
            </Field>
            <Field label={t.phone}>
              <input name="phone" type="tel" defaultValue={kit.phone} maxLength={40} />
            </Field>
          </div>
          <Field label={t.address}>
            <textarea name="address" rows={2} defaultValue={kit.address} maxLength={400} />
          </Field>
        </section>

        <section className="card stack">
          <h2>{t.voice}</h2>
          <Field label={t.tone} hint={t.toneHint}>
            <textarea name="tone" rows={2} defaultValue={kit.tone} maxLength={1000} />
          </Field>
          <Field label={t.dos} hint={t.dosHint}>
            <textarea name="dos" rows={2} defaultValue={kit.dos} maxLength={2000} />
          </Field>
          <Field label={t.donts} hint={t.dontsHint}>
            <textarea name="donts" rows={2} defaultValue={kit.donts} maxLength={2000} />
          </Field>
        </section>

        <section className="card stack">
          <h2>{t.look}</h2>
          <div className="color-grid">
            {COLOR_KEYS.map((key) => (
              <label key={key}>
                {t.colors[key]}
                <input type="color" name={key} defaultValue={kit.colors[key]} />
              </label>
            ))}
          </div>
          <Field label={t.font}>
            <select name="font" defaultValue={kit.font}>
              <option value="sans">{t.fonts.sans}</option>
              <option value="serif">{t.fonts.serif}</option>
            </select>
          </Field>
          <div className="stack-sm">
            <strong>{t.logo}</strong>
            <ImageField name="logo" initial={logo} max={1} disabled={!canEdit} />
          </div>
        </section>

        <section className="card stack">
          <h2>{t.character}</h2>
          <p className="muted">{t.characterIntro}</p>
          <input type="hidden" name="hasCharacter" value={hasCharacter ? '1' : '0'} />
          {hasCharacter ? (
            <>
              <div className="grid">
                <Field label={t.characterName}>
                  <input name="characterName" defaultValue={c?.name} required maxLength={80} />
                </Field>
                <Field label={t.characterRole} hint={t.characterRoleHint}>
                  <input name="characterRole" defaultValue={c?.role} maxLength={160} />
                </Field>
              </div>
              <Field label={t.characterLook} hint={t.characterLookHint}>
                <textarea name="characterLook" rows={3} defaultValue={c?.look} maxLength={2000} />
              </Field>
              <Field label={t.characterPersonality}>
                <textarea name="characterPersonality" rows={2} defaultValue={c?.personality} maxLength={1000} />
              </Field>
              <div className="grid">
                <Field label={t.characterVoice}>
                  <input name="characterVoice" defaultValue={c?.voice} maxLength={600} />
                </Field>
                <Field label={t.catchphrase}>
                  <input name="catchphrase" defaultValue={c?.catchphrase} maxLength={200} />
                </Field>
              </div>
              <Field label={t.characterRules} hint={t.characterRulesHint}>
                <textarea name="characterRules" rows={2} defaultValue={c?.rules} maxLength={1000} />
              </Field>
              <div className="stack-sm">
                <strong>{t.pictures}</strong>
                <small className="muted">{t.picturesHint(MAX_PICTURES)}</small>
                <ImageField name="characterImages" initial={characterImages} max={MAX_PICTURES} disabled={!canEdit} />
              </div>
              {canEdit && (
                <button type="button" className="link small-link" onClick={() => setHasCharacter(false)}>
                  {t.removeCharacter}
                </button>
              )}
            </>
          ) : (
            canEdit && (
              <button type="button" className="secondary" onClick={() => setHasCharacter(true)}>
                {t.addCharacter}
              </button>
            )
          )}
        </section>
      </fieldset>

      {state.error && <p className="error" role="alert">{state.error}</p>}
      {state.success && <p className="success" role="status">{state.success}</p>}
      {canEdit && (
        <button type="submit" disabled={pending}>
          {t.save}
        </button>
      )}
    </form>
  );
}
