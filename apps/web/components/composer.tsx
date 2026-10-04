'use client';

import { useActionState, useState } from 'react';
import { graphemeLength, mastodonLength } from '@postwerk/providers/text';
import type { ComposeState } from '@/app/(app)/posts/actions';

export interface ComposerAccount {
  id: string;
  handle: string;
  providerLabel: string;
  counter: 'mastodon' | 'grapheme' | null;
  maxLength: number | null;
  disabledReason?: string;
}

interface Props {
  accounts: ComposerAccount[];
  action: (state: ComposeState, form: FormData) => Promise<ComposeState>;
}

function count(text: string, counter: ComposerAccount['counter']): number {
  return counter === 'mastodon' ? mastodonLength(text) : graphemeLength(text);
}

export function Composer({ accounts, action }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const [text, setText] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(accounts.filter((a) => !a.disabledReason).map((a) => a.id)));
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [localTime, setLocalTime] = useState('');

  const chosen = accounts.filter((a) => selected.has(a.id));
  const tooLong = chosen.some((a) => a.maxLength !== null && count(text, a.counter) > a.maxLength);
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

  return (
    <form action={formAction} className="card stack">
      <label>
        Post
        <textarea name="text" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="What do you want to share?" required />
      </label>

      <fieldset className="stack">
        <legend>Publish to</legend>
        {accounts.map((account) => {
          const length = count(text, account.counter);
          const over = account.maxLength !== null && length > account.maxLength;
          return (
            <label key={account.id} className="row check">
              <input
                type="checkbox"
                name="accountIds"
                value={account.id}
                checked={selected.has(account.id)}
                disabled={Boolean(account.disabledReason)}
                onChange={() => toggle(account.id)}
              />
              <span className="grow">
                {account.handle} <span className="muted">· {account.providerLabel}</span>
                {account.disabledReason && <span className="badge badge-warn">{account.disabledReason}</span>}
              </span>
              {account.maxLength !== null && (
                <span className={over ? 'error counter' : 'muted counter'}>
                  {length}/{account.maxLength}
                </span>
              )}
            </label>
          );
        })}
      </fieldset>

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
      <button type="submit" disabled={pending || chosen.length === 0 || tooLong || !text.trim()}>
        {pending ? 'Saving…' : when === 'now' ? 'Publish' : 'Schedule'}
      </button>
    </form>
  );
}
