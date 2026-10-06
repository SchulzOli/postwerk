import { redirect } from 'next/navigation';
import { findInvite } from '@postwerk/core';
import { getDb } from '@postwerk/db';
import { AuthForm } from '@/components/auth-form';
import { getSession } from '@/lib/session';
import { signUp } from '../actions';

export const metadata = { title: 'Sign up · Postwerk' };

export default async function SignupPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { invite: token } = await searchParams;
  // Signed-in people accept invites on the invite page itself.
  if (await getSession()) redirect(token ? `/invite/${encodeURIComponent(token)}` : '/canvas');
  const invite = token ? await findInvite(getDb(), token) : undefined;
  return (
    <AuthForm
      mode="signup"
      action={signUp}
      invite={invite?.status === 'valid' ? { token: token!, email: invite.email, workspace: invite.workspace.name } : undefined}
    />
  );
}
