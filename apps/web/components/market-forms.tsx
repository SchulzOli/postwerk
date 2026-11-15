'use client';

import { useActionState, useRef, useState, useTransition } from 'react';
import {
  createProductAction,
  deleteLeadAction,
  deleteProductAction,
  deleteProductLeadsAction,
  disconnectPartnerCenterAction,
  renewLeadAddressAction,
  savePartnerCenterAction,
  syncMarketplaceAction,
  installBuiltinMarketAction,
  installMarketAction,
  saveProductAction,
  uninstallMarketAction,
  type MarketState,
} from '@/app/(app)/brand/markets/actions';
import { keepValues } from '@/lib/form';
import { useMessages } from '@/lib/i18n';
import { listingMessages } from '@/messages/listing';
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

// ------------------------------------------------------------------ Partner Center

export interface PartnerCenterData {
  marketId: string;
  leadUrl: string;
  connected: boolean;
  /** Already formatted for the UI. */
  lastSync: string | null;
  lastError: string | null;
}

/** The lead address and the Entra app of a market whose marketplace is Partner Center. */
export function PartnerCenterCard({ data, canManage }: { data: PartnerCenterData; canManage: boolean }) {
  const t = useMessages(marketsMessages);
  const l = useMessages(listingMessages);
  const [state, action, pending] = useActionState<MarketState, FormData>(savePartnerCenterAction.bind(null, data.marketId), {});
  const [sync, setSync] = useState<MarketState>({});
  const [busy, start] = useTransition();
  const [copied, setCopied] = useState(false);
  return (
    <section className="card stack" id={`partner-center-${data.marketId}`}>
      <div className="row">
        <h2 className="grow">{t.partnerCenter}</h2>
        <span className={data.connected ? 'badge badge-active' : 'badge'}>{data.connected ? t.connected : t.notConnected}</span>
      </div>
      <p className="muted">{t.partnerCenterIntro}</p>

      <div className="stack-sm">
        <strong>{t.leadAddress}</strong>
        <small className="muted">{t.leadAddressHint}</small>
        <div className="row-tight">
          <input readOnly value={data.leadUrl} className="mono" aria-label={t.leadAddress} onFocus={(e) => e.target.select()} />
          <button
            type="button"
            className="small secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(data.leadUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? l.copied : l.copy}
          </button>
          {canManage && (
            <button type="button" className="small secondary nowrap" disabled={busy} onClick={() => confirm(t.confirmRenew) && start(() => renewLeadAddressAction(data.marketId))}>
              {t.renewAddress}
            </button>
          )}
        </div>
      </div>

      {canManage && (
        <form onSubmit={keepValues(action)} className="stack-sm">
          <strong>{t.app}</strong>
          <small className="muted">{t.appHint}</small>
          <div className="grid-3">
            <label>
              {t.tenantId}
              <input name="tenantId" required autoComplete="off" placeholder="contoso.onmicrosoft.com" />
            </label>
            <label>
              {t.clientId}
              <input name="clientId" required autoComplete="off" placeholder="00000000-0000-0000-0000-000000000000" />
            </label>
            <label>
              {t.clientSecret} <small className="muted">{t.secretHint}</small>
              <input name="clientSecret" type="password" required autoComplete="off" />
            </label>
          </div>
          <Feedback state={state} />
          <div className="row">
            <button type="submit" className="align-start" disabled={pending}>{t.saveConnection}</button>
            {data.connected && (
              <button type="button" className="secondary" disabled={busy} onClick={() => start(async () => setSync(await syncMarketplaceAction(data.marketId)))}>
                {t.syncNow}
              </button>
            )}
            <span className="grow" />
            {data.connected && (
              <button type="button" className="secondary danger" disabled={busy} onClick={() => confirm(t.confirmDisconnect) && start(() => disconnectPartnerCenterAction(data.marketId))}>
                {t.disconnect}
              </button>
            )}
          </div>
        </form>
      )}
      <Feedback state={sync} />
      {data.connected && <small className="muted">{data.lastSync ? t.lastSync(data.lastSync) : t.neverSynced}</small>}
      {data.lastError && <small className="warn-text">{t.lastError(data.lastError)}</small>}
    </section>
  );
}

export function DeleteLeadButton({ productId, leadId }: { productId: string; leadId: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" className="small secondary" disabled={pending} onClick={() => start(() => deleteLeadAction(productId, leadId))} aria-label="×">
      ×
    </button>
  );
}

export function DeleteLeadsButton({ productId }: { productId: string }) {
  const t = useMessages(marketsMessages);
  const [pending, start] = useTransition();
  return (
    <button type="button" className="small secondary danger align-start" disabled={pending} onClick={() => confirm(t.confirmDeleteLeads) && start(() => deleteProductLeadsAction(productId))}>
      {t.deleteLeads}
    </button>
  );
}

