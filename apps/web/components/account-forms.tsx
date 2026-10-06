'use client';

import { useActionState, useState, useTransition } from 'react';
import { localeNames, locales, type Locale } from '@postwerk/core/i18n';
import { changePasswordAction, resendVerificationAction, setNotifyFailuresAction, updateNameAction, type AccountState } from '@/app/(app)/account/actions';
import { setLocaleAction } from '@/app/actions/locale';
import { useMessages } from '@/lib/i18n';
import { accountMessages } from '@/messages/account';
import { commonMessages } from '@/messages/common';

function Feedback({ state }: { state: AccountState }) {
  if (state.error) return <p className="error" role="alert">{state.error}</p>;
  if (state.success) return <p className="success" role="status">{state.success}</p>;
  return null;
}

/** The UI (and email) language; empty follows the browser. Applies right away. */
function LanguageSetting({ locale }: { locale: Locale | null }) {
  const t = useMessages(accountMessages);
  const common = useMessages(commonMessages);
  const [current, setCurrent] = useState(locale ?? '');
  const [pending, startTransition] = useTransition();
  return (
    <section className="card stack">
      <h2>{common.language.label}</h2>
      <select
        aria-label={common.language.label}
        value={current}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value as Locale | '';
          setCurrent(next);
          startTransition(() => setLocaleAction(next || null));
        }}
      >
        <option value="">{common.language.automatic}</option>
        {locales.map((option) => (
          <option key={option} value={option} lang={option}>{localeNames[option]}</option>
        ))}
      </select>
      <small className="muted">{t.languageHint}</small>
    </section>
  );
}

interface Props {
  user: { name: string; email: string; verified: boolean; notifyFailures: boolean; locale: Locale | null };
  mailConfigured: boolean;
}

export function AccountForms({ user, mailConfigured }: Props) {
  const [nameState, saveName, savingName] = useActionState(updateNameAction, {});
  const [passwordState, savePassword, savingPassword] = useActionState(changePasswordAction, {});
  const [notifyState, setNotifyState] = useState<AccountState>({});
  const [verifyState, setVerifyState] = useState<AccountState>({});
  const [pending, startTransition] = useTransition();
  const t = useMessages(accountMessages);
  const common = useMessages(commonMessages);

  return (
    <>
      <section className="card stack">
        <h2>{t.profile}</h2>
        <form action={saveName} className="stack">
          <label>
            {t.name}
            <input name="name" defaultValue={user.name} autoComplete="name" maxLength={80} required />
          </label>
          <button type="submit" className="secondary" disabled={savingName}>{t.saveName}</button>
          <Feedback state={nameState} />
        </form>
        <div className="stack-sm">
          <strong>{t.email}</strong>
          <span>
            {user.email}{' '}
            {user.verified ? <span className="badge status-published">{t.confirmed}</span> : mailConfigured && <span className="badge badge-warn">{t.notConfirmed}</span>}
          </span>
          {!user.verified && mailConfigured && (
            <button type="button" className="link" disabled={pending} onClick={() => startTransition(async () => setVerifyState(await resendVerificationAction()))}>
              {t.resendConfirmation}
            </button>
          )}
          <Feedback state={verifyState} />
        </div>
      </section>

      <section className="card stack">
        <h2>{t.password}</h2>
        <form action={savePassword} className="stack">
          <label>
            {t.currentPassword}
            <input name="current" type="password" autoComplete="current-password" required />
          </label>
          <label>
            {t.newPassword}
            <input name="password" type="password" autoComplete="new-password" minLength={10} required />
            <small className="muted">{t.passwordHint}</small>
          </label>
          <button type="submit" disabled={savingPassword}>{savingPassword ? common.saving : t.changePassword}</button>
          <Feedback state={passwordState} />
        </form>
      </section>

      <section className="card stack">
        <h2>{t.notifications}</h2>
        <label className="row check">
          <input
            type="checkbox"
            defaultChecked={user.notifyFailures}
            disabled={pending}
            onChange={(e) => {
              const enabled = e.target.checked;
              startTransition(async () => setNotifyState(await setNotifyFailuresAction(enabled)));
            }}
          />
          {t.notifyFailures}
        </label>
        {!mailConfigured && <small className="muted">{t.mailNotSetUp}</small>}
        <Feedback state={notifyState} />
      </section>

      <LanguageSetting locale={user.locale} />
    </>
  );
}
