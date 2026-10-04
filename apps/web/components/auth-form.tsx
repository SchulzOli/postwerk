'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import type { FormState } from '@/app/(auth)/actions';

interface Props {
  mode: 'login' | 'signup';
  action: (state: FormState, form: FormData) => Promise<FormState>;
}

export function AuthForm({ mode, action }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const signup = mode === 'signup';
  return (
    <form action={formAction} className="card stack auth-card">
      <h1>{signup ? 'Create your account' : 'Welcome back'}</h1>
      {signup && (
        <label>
          Name
          <input name="name" autoComplete="name" defaultValue={state.values?.name} required />
        </label>
      )}
      <label>
        Email
        <input name="email" type="email" autoComplete="email" defaultValue={state.values?.email} required />
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
          <>Already have an account? <Link href="/login">Log in</Link></>
        ) : (
          <>New here? <Link href="/signup">Create an account</Link></>
        )}
      </p>
    </form>
  );
}
