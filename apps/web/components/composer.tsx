'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { baseText, planPost, type FlowGraph } from '@postwerk/core/flow';
import { catalog, type ProviderId } from '@postwerk/providers/catalog';
import { localizeInfo } from '@postwerk/providers/messages';
import { countText } from '@postwerk/providers/text';
import { textLimit, validateContent } from '@postwerk/providers/validate';
import type { ComposeState } from '@/app/(app)/posts/actions';
import { useLocale, useMessages } from '@/lib/i18n';
import { commonMessages } from '@/messages/common';
import { composerMessages } from '@/messages/composer';
import { isReady, MediaPicker, mediaField, type ComposerMedia } from './media-picker';

export interface ComposerAccount {
  id: string;
  handle: string;
  provider: ProviderId;
  maxLength: number | null;
  disabledReason?: string;
}

type Options = Partial<Record<ProviderId, Record<string, string>>>;

/** Starting values: an existing post to edit (with `postId`), or one to post again. */
export interface ComposerInitial {
  postId?: string;
  text: string;
  media: ComposerMedia[];
  accountIds: string[];
  flowId: string;
  options: Options;
  variants: Record<string, string>;
  /** ISO time if the post is scheduled for later. */
  scheduledAt: string | null;
}

interface Props {
  accounts: ComposerAccount[];
  /** Saved flows; picking one replaces the manual account selection. */
  flows?: { id: string; name: string; graph: FlowGraph }[];
  action: (state: ComposeState, form: FormData) => Promise<ComposeState>;
  /** Where to go after publishing ('/posts' or '/canvas'). */
  returnTo?: '/posts' | '/canvas';
  initial?: ComposerInitial;
  /** ISO time a new post is scheduled for at first (planned from the calendar). */
  scheduledAt?: string;
  /** Called after a successful save (canvas only; the list view navigates away). */
  onSaved?(): void;
  onCancel?(): void;
}

/** "2026-10-06T14:30" in the browser's time zone, for datetime-local inputs. */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function Composer({ accounts, flows = [], action, returnTo = '/posts', initial, scheduledAt: startAt, onSaved, onCancel }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const locale = useLocale();
  const t = useMessages(composerMessages);
  const common = useMessages(commonMessages);
  const editing = Boolean(initial?.postId);
  const [text, setText] = useState(initial?.text ?? '');
  const [attachments, setAttachments] = useState<ComposerMedia[]>(initial?.media ?? []);
  const [options, setOptions] = useState<Options>(initial?.options ?? {});
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initial && !initial.flowId ? initial.accountIds : accounts.filter((a) => !a.disabledReason).map((a) => a.id)),
  );
  const [variants, setVariants] = useState<Record<string, string>>(initial?.variants ?? {});
  const firstTime = initial?.scheduledAt ?? startAt;
  const [when, setWhen] = useState<'now' | 'later'>(firstTime ? 'later' : 'now');
  const [localTime, setLocalTime] = useState('');
  const [flowId, setFlowId] = useState(initial?.flowId ?? '');

  // The local time depends on the browser's time zone, so it is filled in after hydration.
  useEffect(() => {
    if (firstTime) setLocalTime(toLocalInput(firstTime));
  }, [firstTime]);
  useEffect(() => {
    if (state.saved) onSaved?.();
  }, [state.saved]); // eslint-disable-line react-hooks/exhaustive-deps

  // Validation sees what will be posted: finished uploads and links, with their sizes.
  const media = useMemo(() => attachments.filter(isReady).map(({ url, kind, size, altText }) => ({ url, kind, size, altText })), [attachments]);
  const uploading = attachments.some((item) => item.progress !== undefined);
  const failedUploads = attachments.some((item) => item.error);
  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const flow = flows.find((f) => f.id === flowId);
  // The same planning the server does: each network's own text, then the flow.
  const plan = useMemo(
    () =>
      planPost({ text, variants, providerOf: (id) => byId.get(id)?.provider, graph: flow?.graph, accountIds: [...selected], locale }, (accountId, candidate) => {
        const account = byId.get(accountId);
        if (!account) return { length: 0, max: Infinity };
        const info = catalog[account.provider];
        return { length: countText(candidate, info.capabilities.text.counter), max: textLimit(info, { media }, { maxLength: account.maxLength ?? undefined }) };
      }),
    [text, variants, flow, selected, media, byId, locale],
  );
  const chosen = plan.targets.flatMap((t) => byId.get(t.accountId) ?? []);
  const textFor = (account: ComposerAccount) => plan.targets.find((t) => t.accountId === account.id)?.text ?? baseText(text, variants, account.provider);
  const empty = !text.trim() && media.length === 0;
  const allIssuesFor = (account: ComposerAccount) =>
    validateContent(catalog[account.provider], { text: textFor(account), media, options: options[account.provider] ?? {} }, { maxLength: account.maxLength ?? undefined }, locale);
  // Before anything is written, "add some text" under every account is just noise; the button stays disabled.
  const issuesFor = (account: ComposerAccount) => (empty ? [] : allIssuesFor(account));
  const missing = flow ? plan.targets.filter((t) => !byId.has(t.accountId)).length : 0;
  const blocked = empty || uploading || failedUploads || chosen.some((account) => allIssuesFor(account).length > 0) || plan.errors.length > 0 || missing > 0;
  const chosenProviders = [...new Set(chosen.map((a) => a.provider))];
  const optionProviders = chosenProviders.filter((id) => catalog[id].capabilities.options.length > 0);
  // datetime-local has no time zone; convert in the browser so the server gets an exact instant.
  const scheduledAt = localTime ? new Date(localTime).toISOString() : '';

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setOption(provider: ProviderId, key: string, value: string) {
    setOptions((current) => ({ ...current, [provider]: { ...current[provider], [key]: value } }));
  }

  function setVariant(provider: ProviderId, value: string | undefined) {
    setVariants((current) => {
      const next = { ...current };
      if (value === undefined) delete next[provider];
      else next[provider] = value;
      return next;
    });
  }

  const counter = (account: ComposerAccount) => {
    const info = catalog[account.provider];
    const max = textLimit(info, { media }, { maxLength: account.maxLength ?? undefined });
    const length = countText(textFor(account), info.capabilities.text.counter);
    return <span className={length > max ? 'error counter' : 'muted counter'}>{length}/{max}</span>;
  };

  return (
    <form action={formAction} className="card stack">
      {initial?.postId && <input type="hidden" name="postId" value={initial.postId} />}
      <label>
        {t.post}
        <textarea name="text" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={t.placeholder} />
      </label>

      <fieldset className="stack-sm">
        <legend>
          {t.media} <span className="muted">{t.optional}</span>
        </legend>
        <MediaPicker items={attachments} setItems={setAttachments} />
        {failedUploads && <small className="error">{t.removeFailedUploads}</small>}
        <input type="hidden" name="media" value={mediaField(attachments)} />
      </fieldset>

      <input type="hidden" name="returnTo" value={returnTo} />
      {flows.length > 0 && (
        <label>
          {t.flow}
          <select name="flowId" value={flowId} onChange={(e) => setFlowId(e.target.value)}>
            <option value="">{t.noFlow}</option>
            {flows.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </label>
      )}

      {flow && (
        <fieldset className="stack">
          <legend>{t.flowPublishesTo}</legend>
          {plan.errors.map((error) => (
            <small key={error} className="error">{error}</small>
          ))}
          {missing > 0 && <small className="error">{t.flowAccountGone}</small>}
          {chosen.map((account) => {
            const target = plan.targets.find((t) => t.accountId === account.id)!;
            return (
              <div key={account.id} className="stack-sm flow-target">
                <div className="row-tight">
                  <span className="grow">
                    {account.handle} <span className="muted">· {catalog[account.provider].name}</span>
                    {target.delayMinutes > 0 && <span className="muted">{t.afterMinutes(target.delayMinutes)}</span>}
                  </span>
                  {counter(account)}
                </div>
                {target.text !== text && <pre className="flow-text">{target.text}</pre>}
                {issuesFor(account).map((issue) => (
                  <small key={issue} className="error">{issue}</small>
                ))}
              </div>
            );
          })}
        </fieldset>
      )}

      <fieldset className="stack" hidden={Boolean(flow)}>
        <legend>{t.publishTo}</legend>
        {accounts.map((account) => {
          const issues = !flow && selected.has(account.id) ? issuesFor(account) : [];
          return (
            <div key={account.id} className="stack-sm">
              <label className="row check">
                <input
                  type="checkbox"
                  name="accountIds"
                  value={account.id}
                  checked={selected.has(account.id)}
                  disabled={(Boolean(account.disabledReason) && !selected.has(account.id)) || Boolean(flow)}
                  onChange={() => toggle(account.id)}
                />
                <span className="grow">
                  {account.handle} <span className="muted">· {catalog[account.provider].name}</span>
                  {account.disabledReason && <span className="badge badge-warn">{account.disabledReason}</span>}
                </span>
                {counter(account)}
              </label>
              {issues.map((issue) => (
                <small key={issue} className="error">{issue}</small>
              ))}
            </div>
          );
        })}
      </fieldset>

      {chosenProviders.length > 0 && (
        <fieldset className="stack-sm variants">
          <legend>{t.customize}</legend>
          {chosenProviders.map((provider) => {
            const info = catalog[provider];
            const value = variants[provider];
            if (value === undefined) {
              return (
                <button key={provider} type="button" className="link small-link" onClick={() => setVariant(provider, text)}>
                  {t.writeDifferent(info.name)}
                </button>
              );
            }
            return (
              <div key={provider} className="stack-sm variant">
                <label>
                  <span className="row-tight">
                    <span className="grow">{t.textFor(info.name)}</span>
                    <button type="button" className="link small-link" onClick={() => setVariant(provider, undefined)}>
                      {t.useMainText}
                    </button>
                  </span>
                  <textarea name={`variant:${provider}`} rows={4} value={value} onChange={(e) => setVariant(provider, e.target.value)} />
                </label>
                {flow && <small className="muted">{t.flowStepsApply}</small>}
              </div>
            );
          })}
        </fieldset>
      )}

      {optionProviders.map((provider) => (
        <fieldset key={provider} className="stack option-group">
          <legend>{catalog[provider].name}</legend>
          {localizeInfo(catalog[provider], locale).capabilities.options.map((field) => {
            const name = `option:${provider}:${field.key}`;
            const value = options[provider]?.[field.key] ?? field.defaultValue ?? '';
            return (
              <label key={field.key}>
                <span>
                  {field.label}
                  {!field.required && <span className="muted"> {t.optional}</span>}
                </span>
                {field.choices ? (
                  <select name={name} value={value} onChange={(e) => setOption(provider, field.key, e.target.value)}>
                    {!field.defaultValue && <option value="">{t.choose}</option>}
                    {field.choices.map((choice) => (
                      <option key={choice.value} value={choice.value}>{choice.label}</option>
                    ))}
                  </select>
                ) : (
                  <input name={name} value={value} maxLength={field.maxLength} onChange={(e) => setOption(provider, field.key, e.target.value)} />
                )}
                {field.hint && <small className="muted">{field.hint}</small>}
              </label>
            );
          })}
        </fieldset>
      ))}

      <fieldset className="stack">
        <legend>{t.when}</legend>
        <label className="row check">
          <input type="radio" name="when" value="now" checked={when === 'now'} onChange={() => setWhen('now')} /> {t.publishNow}
        </label>
        <label className="row check">
          <input type="radio" name="when" value="later" checked={when === 'later'} onChange={() => setWhen('later')} /> {t.schedule}
        </label>
        {when === 'later' && (
          <input type="datetime-local" aria-label={t.dateTime} value={localTime} onChange={(e) => setLocalTime(e.target.value)} required />
        )}
        <input type="hidden" name="scheduledAt" value={scheduledAt} />
      </fieldset>

      {state.errors && (
        <ul className="error" role="alert">
          {state.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
      <div className="row composer-actions">
        <button type="submit" className="grow" disabled={pending || chosen.length === 0 || blocked}>
          {pending ? common.saving : uploading ? t.uploading : when === 'now' ? t.publishNow : editing ? t.saveChanges : t.schedule}
        </button>
        {onCancel && (
          <button type="button" className="secondary" onClick={onCancel}>
            {editing ? t.stopEditing : common.cancel}
          </button>
        )}
      </div>
    </form>
  );
}
