'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { requestResetAction, type FormState } from '@/app/(auth)/actions';
import { useMessages } from '@/lib/i18n';
import { authMessages } from '@/messages/auth';
import { commonMessages } from '@/messages/common';

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestResetAction, {});
  const t = useMessages(authMessages);
  if (state.sent) {
    return (
      <div className="card stack auth-card">
        <h1>{t.forgot.checkEmail}</h1>
        <p>{t.forgot.sent(state.sent)}</p>
        <Link href="/login">{t.forgot.backToLogin}</Link>
      </div>
    );
  }
  return (
    <form action={action} className="card stack auth-card">
      <h1>{t.forgot.title}</h1>
      <p className="muted">{t.forgot.intro}</p>
      <label>
        {t.form.email}
        <input name="email" type="email" autoComplete="email" required />
      </label>
      {state.error && <p className="error" role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>{pending ? t.forgot.sending : t.forgot.sendLink}</button>
      <Link href="/login">{t.forgot.backToLogin}</Link>
    </form>
  );
}

export function ResetPasswordForm({ action }: { action: (state: FormState, form: FormData) => Promise<FormState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  const t = useMessages(authMessages).reset;
  const common = useMessages(commonMessages);
  return (
    <form action={formAction} className="card stack auth-card">
      <h1>{t.title}</h1>
      <label>
        {t.newPassword}
        <input name="password" type="password" autoComplete="new-password" minLength={10} required />
        <small className="muted">{t.hint}</small>
      </label>
      {state.error && <p className="error" role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>{pending ? common.saving : t.saveAndLogIn}</button>
    </form>
  );
}
