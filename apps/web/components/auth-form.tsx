'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import type { FormState } from '@/app/(auth)/actions';

interface Props {
  mode: 'login' | 'signup';
  action: (state: FormState, form: FormData) => Promise<FormState>;
  /** An invite link this form should accept after signing in. */
  invite?: { token: string; email: string | null; workspace: string };
}

export function AuthForm({ mode, action, invite }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const signup = mode === 'signup';
  const query = invite ? `?invite=${encodeURIComponent(invite.token)}` : '';
  return (
    <form action={formAction} className="card stack auth-card">
      <h1>{signup ? 'Create your account' : 'Welcome back'}</h1>
      {invite && <p className="muted">You will join {invite.workspace} right after.</p>}
      {invite && <input type="hidden" name="invite" value={invite.token} />}
      {signup && (
        <label>
          Name
          <input name="name" autoComplete="name" defaultValue={state.values?.name} required />
        </label>
      )}
      <label>
        Email
        <input name="email" type="email" autoComplete="email" defaultValue={state.values?.email ?? invite?.email ?? undefined} required />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete={signup ? 'new-password' : 'current-password'}
          minLength={signup ? 10 : undefined}
          required
        />
      </label>
      {state.error && <p className="error" role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? 'Please wait…' : signup ? 'Sign up' : 'Log in'}
      </button>
      <p className="muted">
        {signup ? (
          <>Already have an account? <Link href={`/login${query}`}>Log in</Link></>
        ) : (
          <>New here? <Link href={`/signup${query}`}>Create an account</Link></>
        )}
      </p>
    </form>
  );
}
