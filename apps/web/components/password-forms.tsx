'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { requestResetAction, type FormState } from '@/app/(auth)/actions';

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestResetAction, {});
  if (state.sent) {
    return (
      <div className="card stack auth-card">
        <h1>Check your email</h1>
        <p>If there is an account for {state.sent}, we just sent it a link to choose a new password. It works for one hour.</p>
        <Link href="/login">Back to log in</Link>
      </div>
    );
  }
  return (
    <form action={action} className="card stack auth-card">
      <h1>Forgot your password?</h1>
      <p className="muted">Enter your email address and we send you a link to choose a new one.</p>
      <label>
        Email
        <input name="email" type="email" autoComplete="email" required />
      </label>
      {state.error && <p className="error" role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>{pending ? 'Sending…' : 'Send link'}</button>
      <Link href="/login">Back to log in</Link>
    </form>
  );
}

export function ResetPasswordForm({ action }: { action: (state: FormState, form: FormData) => Promise<FormState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="card stack auth-card">
      <h1>Choose a new password</h1>
      <label>
        New password
        <input name="password" type="password" autoComplete="new-password" minLength={10} required />
        <small className="muted">At least 10 characters. You will be signed out everywhere else.</small>
      </label>
      {state.error && <p className="error" role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save and log in'}</button>
    </form>
  );
}
