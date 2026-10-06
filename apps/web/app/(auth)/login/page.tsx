import { redirect } from 'next/navigation';
import { findInvite } from '@postwerk/core';
import { getDb } from '@postwerk/db';
import { AuthForm } from '@/components/auth-form';
import { getMessages } from '@/lib/i18n-server';
import { getSession } from '@/lib/session';
import { authMessages } from '@/messages/auth';
import { commonMessages } from '@/messages/common';
import { logIn } from '../actions';

export async function generateMetadata() {
  const [t, common] = await Promise.all([getMessages(authMessages), getMessages(commonMessages)]);
  return { title: common.title(t.titles.login) };
}

/** `?notice=` values and their messages in `authMessages.notices`. */
const notices = {
  verified: { kind: 'success', message: 'verified' },
  'verify-expired': { kind: 'error', message: 'verifyExpired' },
} as const;

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { invite: token, notice } = await searchParams;
  // Signed-in people accept invites on the invite page itself.
  if (await getSession()) redirect(token ? `/invite/${encodeURIComponent(token)}` : '/canvas');
  const [invite, t] = await Promise.all([token ? findInvite(getDb(), token) : undefined, getMessages(authMessages)]);
  const shown = notice && notice in notices ? notices[notice as keyof typeof notices] : undefined;
  return (
    <AuthForm
      mode="login"
      action={logIn}
      invite={invite?.status === 'valid' ? { token: token!, email: invite.email, workspace: invite.workspace.name } : undefined}
      notice={shown ? { kind: shown.kind, text: t.notices[shown.message] } : undefined}
    />
  );
}
