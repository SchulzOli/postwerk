'use client';

import { useActionState, useState, useTransition } from 'react';
import { changePasswordAction, resendVerificationAction, setNotifyFailuresAction, updateNameAction, type AccountState } from '@/app/(app)/account/actions';

function Feedback({ state }: { state: AccountState }) {
  if (state.error) return <p className="error" role="alert">{state.error}</p>;
  if (state.success) return <p className="success" role="status">{state.success}</p>;
  return null;
}

interface Props {
  user: { name: string; email: string; verified: boolean; notifyFailures: boolean };
  mailConfigured: boolean;
}

export function AccountForms({ user, mailConfigured }: Props) {
  const [nameState, saveName, savingName] = useActionState(updateNameAction, {});
  const [passwordState, savePassword, savingPassword] = useActionState(changePasswordAction, {});
  const [notifyState, setNotifyState] = useState<AccountState>({});
  const [verifyState, setVerifyState] = useState<AccountState>({});
  const [pending, startTransition] = useTransition();

  return (
    <>
      <section className="card stack">
        <h2>Profile</h2>
        <form action={saveName} className="stack">
          <label>
            Name
            <input name="name" defaultValue={user.name} autoComplete="name" maxLength={80} required />
          </label>
          <button type="submit" className="secondary" disabled={savingName}>Save name</button>
          <Feedback state={nameState} />
        </form>
        <div className="stack-sm">
          <strong>Email</strong>
          <span>
            {user.email}{' '}
            {user.verified ? <span className="badge status-published">Confirmed</span> : mailConfigured && <span className="badge badge-warn">Not confirmed</span>}
          </span>
          {!user.verified && mailConfigured && (
            <button type="button" className="link" disabled={pending} onClick={() => startTransition(async () => setVerifyState(await resendVerificationAction()))}>
              Send the confirmation email again
            </button>
          )}
          <Feedback state={verifyState} />
        </div>
      </section>

      <section className="card stack">
        <h2>Password</h2>
        <form action={savePassword} className="stack">
          <label>
            Current password
            <input name="current" type="password" autoComplete="current-password" required />
          </label>
          <label>
            New password
            <input name="password" type="password" autoComplete="new-password" minLength={10} required />
            <small className="muted">At least 10 characters. Other devices are signed out.</small>
          </label>
          <button type="submit" disabled={savingPassword}>{savingPassword ? 'Saving…' : 'Change password'}</button>
          <Feedback state={passwordState} />
        </form>
      </section>

      <section className="card stack">
        <h2>Notifications</h2>
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
          Email me when one of my posts fails or only partly goes out
        </label>
        {!mailConfigured && <small className="muted">Email is not set up on this server yet (SMTP_URL), so nothing is sent.</small>}
        <Feedback state={notifyState} />
      </section>
    </>
  );
}
