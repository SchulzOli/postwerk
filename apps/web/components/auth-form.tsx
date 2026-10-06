'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import type { FormState } from '@/app/(auth)/actions';
import { useMessages } from '@/lib/i18n';
import { authMessages } from '@/messages/auth';

interface Props {
  mode: 'login' | 'signup';
  action: (state: FormState, form: FormData) => Promise<FormState>;
  /** An invite link this form should accept after signing in. */
  invite?: { token: string; email: string | null; workspace: string };
  /** A message from an earlier step (e.g. "email confirmed"). */
  notice?: { kind: 'success' | 'error'; text: string };
}

export function AuthForm({ mode, action, invite, notice }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const t = useMessages(authMessages).form;
  const signup = mode === 'signup';
  const query = invite ? `?invite=${encodeURIComponent(invite.token)}` : '';
  return (
    <form action={formAction} className="card stack auth-card">
      <h1>{signup ? t.signupTitle : t.loginTitle}</h1>
      {notice && <p className={notice.kind} role="status">{notice.text}</p>}
      {invite && <p className="muted">{t.joinAfter(invite.workspace)}</p>}
      {invite && <input type="hidden" name="invite" value={invite.token} />}
      {signup && (
        <label>
          {t.name}
          <input name="name" autoComplete="name" defaultValue={state.values?.name} required />
        </label>
      )}
      <label>
        {t.email}
        <input name="email" type="email" autoComplete="email" defaultValue={state.values?.email ?? invite?.email ?? undefined} required />
      </label>
      <label>
        {t.password}
        <input
          name="password"
          type="password"
          autoComplete={signup ? 'new-password' : 'current-password'}
          minLength={signup ? 10 : undefined}
          required
        />
        {!signup && (
          <Link href="/forgot-password" className="small-link">
            {t.forgotPassword}
          </Link>
        )}
      </label>
      {state.error && <p className="error" role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? t.pleaseWait : signup ? t.signUp : t.logIn}
      </button>
      <p className="muted">
        {signup ? (
          <>{t.haveAccount} <Link href={`/login${query}`}>{t.logIn}</Link></>
        ) : (
          <>{t.newHere} <Link href={`/signup${query}`}>{t.createAccount}</Link></>
        )}
      </p>
    </form>
  );
}
