'use client';

import { useActionState, useRef, useTransition } from 'react';
import {
  createProductAction,
  deleteProductAction,
  installBuiltinMarketAction,
  installMarketAction,
  saveProductAction,
  uninstallMarketAction,
  type MarketState,
} from '@/app/(app)/brand/markets/actions';
import { keepValues } from '@/lib/form';
import { useMessages } from '@/lib/i18n';
import { marketsMessages } from '@/messages/markets';

function Feedback({ state }: { state: MarketState }) {
  return (
    <>
      {state.error && <p className="error" role="alert">{state.error}</p>}
      {state.success && <p className="success" role="status">{state.success}</p>}
    </>
  );
}

export function InstallBuiltinMarketButton({ marketId }: { marketId: string }) {
  const t = useMessages(marketsMessages);
  const [pending, start] = useTransition();
  return (
    <button type="button" className="small" disabled={pending} onClick={() => start(() => installBuiltinMarketAction(marketId))}>
      {t.install}
    </button>
  );
}

export function UninstallMarketButton({ marketId, name }: { marketId: string; name: string }) {
  const t = useMessages(marketsMessages);
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="small secondary"
      disabled={pending}
      onClick={() => {
        if (confirm(t.confirmUninstall(name))) start(() => uninstallMarketAction(marketId));
      }}
    >
      {t.uninstall}
    </button>
  );
}

/** Offers a custom market's file for download, so it can be shared and installed elsewhere. */
export function DownloadMarketButton({ manifest }: { manifest: { id: string } }) {
  const t = useMessages(marketsMessages);
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: `${manifest.id}.market.json` });
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <button type="button" className="small secondary" onClick={download}>
      {t.download}
    </button>
  );
}

export function InstallMarketForm({ docsUrl }: { docsUrl: string }) {
  const t = useMessages(marketsMessages);
  const [state, action, pending] = useActionState<MarketState, FormData>(installMarketAction, {});
  const text = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  return (
    <form onSubmit={keepValues(action)} className="card stack">
      <h2>{t.addMarket}</h2>
      <p className="muted">{t.addMarketIntro}</p>
      <label>
        {t.marketFile}
        <textarea ref={text} name="manifest" rows={8} className="mono" spellCheck={false} required placeholder={'{\n  "kind": "market",\n  "id": "my-market",\n  …'} />
      </label>
      <input
        ref={file}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={async (event) => {
          const chosen = event.target.files?.[0];
          if (chosen && text.current) text.current.value = await chosen.text();
        }}
      />
      <Feedback state={state} />
      <div className="row">
        <button type="submit" disabled={pending}>{t.install}</button>
        <button type="button" className="secondary" onClick={() => file.current?.click()}>{t.uploadFile}</button>
        <span className="grow" />
        <a className="small-link" href={docsUrl} target="_blank" rel="noreferrer">{t.howItWorks}</a>
      </div>
    </form>
  );
}

/** A profile field the product's market adds, with its texts already in the UI language. */
export interface MarketField {
  id: string;
  label: string;
  hint?: string;
  type: 'text' | 'choice' | 'choices';
  options?: { id: string; label: string }[];
  required: boolean;
}

export interface ProductFormData {
  id?: string;
  marketId: string;
  marketName: string;
  name: string;
  profile: Record<string, string | string[]>;
}

const text = (value: string | string[] | undefined) => (Array.isArray(value) ? value.join('\n') : (value ?? ''));
const chosen = (value: string | string[] | undefined) => (Array.isArray(value) ? value : value ? [value] : []);

/** A product's profile: the common fields and its market's own. */
export function ProductForm({ product, fields, maxFeatures, canEdit }: { product: ProductFormData; fields: MarketField[]; maxFeatures: number; canEdit: boolean }) {
  const t = useMessages(marketsMessages);
  const save = product.id ? saveProductAction.bind(null, product.id) : createProductAction.bind(null, product.marketId);
  const [state, action, pending] = useActionState<MarketState, FormData>(save, {});
  const [deleting, startDelete] = useTransition();
  const value = (field: string) => text(product.profile[field]);
  const input = (field: string, label: string, hint?: string, placeholder?: string) => (
    <label>
      {label} {hint && <small className="muted">{hint}</small>}
      <input name={`profile:${field}`} defaultValue={value(field)} placeholder={placeholder} maxLength={300} />
    </label>
  );
  return (
    <form onSubmit={keepValues(action)} className="stack-lg">
      <fieldset disabled={!canEdit} className="stack-lg">
        <section className="card stack">
          <h2>{t.profile}</h2>
          <p className="muted">{t.profileIntro}</p>
          <label>
            {t.name}
            <input name="name" defaultValue={product.name} required maxLength={120} />
          </label>
          <label>
            {t.does} <small className="muted">{t.doesHint} · {t.required}</small>
            <textarea name="profile:does" rows={2} defaultValue={value('does')} maxLength={600} />
          </label>
          <label>
            {t.audience} <small className="muted">{t.audienceHint}</small>
            <textarea name="profile:audience" rows={2} defaultValue={value('audience')} maxLength={600} />
          </label>
          <label>
            {t.features} <small className="muted">{t.featuresHint(maxFeatures)}</small>
            <textarea name="profile:features" rows={4} defaultValue={value('features')} />
          </label>
        </section>

        {fields.length > 0 && (
          <section className="card stack">
            <h2>{t.marketFields(product.marketName)}</h2>
            <div className="grid-2">
              {fields.map((field) =>
                field.type === 'text' ? (
                  <label key={field.id}>
                    {field.label} <small className="muted">{[field.hint, field.required && t.required].filter(Boolean).join(' · ')}</small>
                    <input name={`profile:${field.id}`} defaultValue={value(field.id)} maxLength={300} />
                  </label>
                ) : field.type === 'choice' ? (
                  <label key={field.id}>
                    {field.label} <small className="muted">{[field.hint, field.required && t.required].filter(Boolean).join(' · ')}</small>
                    <select name={`profile:${field.id}`} defaultValue={chosen(product.profile[field.id])[0] ?? ''}>
                      <option value="">–</option>
                      {field.options?.map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <fieldset key={field.id} className="stack-sm">
                    <legend>
                      {field.label} <small className="muted">{[field.hint, field.required && t.required].filter(Boolean).join(' · ')}</small>
                    </legend>
                    <input type="hidden" name={`multiple:${field.id}`} value="1" />
                    <div className="row">
                      {field.options?.map((option) => (
                        <label key={option.id} className="check">
                          <input type="checkbox" name={`profile:${field.id}`} value={option.id} defaultChecked={chosen(product.profile[field.id]).includes(option.id)} /> {option.label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ),
              )}
            </div>
          </section>
        )}

        <section className="card stack">
          <h2>{t.where}</h2>
          <div className="grid-2">
            {input('countries', t.countries, undefined, t.countriesHint)}
            {input('languages', t.languages, undefined, t.languagesHint)}
            {input('price', t.price, undefined, t.pricePlaceholder)}
          </div>
        </section>

        <section className="card stack">
          <h2>{t.links}</h2>
          <div className="grid-2">
            {input('help', t.help, undefined, 'https://')}
            {input('privacy', t.privacy, undefined, 'https://')}
            {input('support', t.support)}
            {input('video', t.video, undefined, 'https://')}
          </div>
        </section>
      </fieldset>
      <Feedback state={state} />
      {canEdit && (
        <div className="row">
          <button type="submit" disabled={pending}>{product.id ? t.save : t.create}</button>
          <span className="grow" />
          {product.id && (
            <button
              type="button"
              className="secondary danger"
              disabled={deleting}
              onClick={() => {
                if (confirm(t.confirmDelete)) startDelete(() => deleteProductAction(product.id!));
              }}
            >
              {t.deleteProduct}
            </button>
          )}
        </div>
      )}
    </form>
  );
}
