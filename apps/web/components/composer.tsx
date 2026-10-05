'use client';

import { useActionState, useMemo, useState } from 'react';
import { catalog, type ProviderId } from '@postwerk/providers/catalog';
import { countText } from '@postwerk/providers/text';
import { textLimit, validateContent } from '@postwerk/providers/validate';
import type { ComposeState } from '@/app/(app)/posts/actions';
import { parseMediaLines } from '@/lib/media';

export interface ComposerAccount {
  id: string;
  handle: string;
  provider: ProviderId;
  maxLength: number | null;
  disabledReason?: string;
}

interface Props {
  accounts: ComposerAccount[];
  action: (state: ComposeState, form: FormData) => Promise<ComposeState>;
}

type Options = Partial<Record<ProviderId, Record<string, string>>>;

export function Composer({ accounts, action }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const [text, setText] = useState('');
  const [mediaInput, setMediaInput] = useState('');
  const [options, setOptions] = useState<Options>({});
  const [selected, setSelected] = useState<Set<string>>(() => new Set(accounts.filter((a) => !a.disabledReason).map((a) => a.id)));
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [localTime, setLocalTime] = useState('');

  const { media, errors: mediaErrors } = useMemo(() => parseMediaLines(mediaInput), [mediaInput]);
  const chosen = accounts.filter((a) => selected.has(a.id));
  const issuesFor = (account: ComposerAccount) =>
    validateContent(catalog[account.provider], { text, media, options: options[account.provider] ?? {} }, { maxLength: account.maxLength ?? undefined });
  const blocked = chosen.some((account) => issuesFor(account).length > 0) || mediaErrors.length > 0;
  const optionProviders = [...new Set(chosen.map((a) => a.provider))].filter((id) => catalog[id].capabilities.options.length > 0);
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

  return (
    <form action={formAction} className="card stack">
      <label>
        Post
        <textarea name="text" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="What do you want to share?" />
      </label>

      <label>
        <span>
          Media <span className="muted">(optional)</span>
        </span>
        <textarea
          name="media"
          rows={2}
          value={mediaInput}
          onChange={(e) => setMediaInput(e.target.value)}
          placeholder={'https://example.com/photo.jpg | Alt text\nhttps://example.com/clip.mp4'}
        />
        <small className="muted">One public https link per line; add “| description” for alt text. Uploads are coming soon.</small>
        {mediaErrors.map((error) => (
          <small key={error} className="error">{error}</small>
        ))}
      </label>

      <fieldset className="stack">
        <legend>Publish to</legend>
        {accounts.map((account) => {
          const info = catalog[account.provider];
          const content = { media };
          const max = textLimit(info, content, { maxLength: account.maxLength ?? undefined });
          const length = countText(text, info.capabilities.text.counter);
          const issues = selected.has(account.id) ? issuesFor(account) : [];
          return (
            <div key={account.id} className="stack-sm">
              <label className="row check">
                <input
                  type="checkbox"
                  name="accountIds"
                  value={account.id}
                  checked={selected.has(account.id)}
                  disabled={Boolean(account.disabledReason)}
                  onChange={() => toggle(account.id)}
                />
                <span className="grow">
                  {account.handle} <span className="muted">· {info.name}</span>
                  {account.disabledReason && <span className="badge badge-warn">{account.disabledReason}</span>}
                </span>
                <span className={length > max ? 'error counter' : 'muted counter'}>
                  {length}/{max}
                </span>
              </label>
              {issues.map((issue) => (
                <small key={issue} className="error">{issue}</small>
              ))}
            </div>
          );
        })}
      </fieldset>

      {optionProviders.map((provider) => (
        <fieldset key={provider} className="stack option-group">
          <legend>{catalog[provider].name}</legend>
          {catalog[provider].capabilities.options.map((field) => {
            const name = `option:${provider}:${field.key}`;
            const value = options[provider]?.[field.key] ?? field.defaultValue ?? '';
            return (
              <label key={field.key}>
                <span>
                  {field.label}
                  {!field.required && <span className="muted"> (optional)</span>}
                </span>
                {field.choices ? (
                  <select name={name} value={value} onChange={(e) => setOption(provider, field.key, e.target.value)}>
                    {!field.defaultValue && <option value="">Choose…</option>}
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
        <legend>When</legend>
        <label className="row check">
          <input type="radio" name="when" value="now" checked={when === 'now'} onChange={() => setWhen('now')} /> Publish now
        </label>
        <label className="row check">
          <input type="radio" name="when" value="later" checked={when === 'later'} onChange={() => setWhen('later')} /> Schedule
        </label>
        {when === 'later' && (
          <input type="datetime-local" aria-label="Date and time" value={localTime} onChange={(e) => setLocalTime(e.target.value)} required />
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
      <button type="submit" disabled={pending || chosen.length === 0 || blocked}>
        {pending ? 'Saving…' : when === 'now' ? 'Publish' : 'Schedule'}
      </button>
    </form>
  );
}
