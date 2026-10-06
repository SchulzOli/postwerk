import { redirect } from 'next/navigation';
import { findInvite } from '@postwerk/core';
import { getDb } from '@postwerk/db';
import { AuthForm } from '@/components/auth-form';
import { getSession } from '@/lib/session';
import { logIn } from '../actions';

export const metadata = { title: 'Log in · Postwerk' };

const notices = {
  verified: { kind: 'success', text: 'Your email address is confirmed. Log in to continue.' },
  'verify-expired': { kind: 'error', text: 'That confirmation link has expired. Log in and send a new one.' },
} as const;

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { invite: token, notice } = await searchParams;
  // Signed-in people accept invites on the invite page itself.
  if (await getSession()) redirect(token ? `/invite/${encodeURIComponent(token)}` : '/canvas');
  const invite = token ? await findInvite(getDb(), token) : undefined;
  return (
    <AuthForm
      mode="login"
      action={logIn}
      invite={invite?.status === 'valid' ? { token: token!, email: invite.email, workspace: invite.workspace.name } : undefined}
      notice={notice && notice in notices ? notices[notice as keyof typeof notices] : undefined}
    />
  );
}
