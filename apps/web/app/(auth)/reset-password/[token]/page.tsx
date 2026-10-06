import Link from 'next/link';
import { isEmailTokenValid } from '@postwerk/core';
import { getDb } from '@postwerk/db';
import { ResetPasswordForm } from '@/components/password-forms';
import { getMessages } from '@/lib/i18n-server';
import { authMessages } from '@/messages/auth';
import { commonMessages } from '@/messages/common';
import { resetPasswordAction } from '../../actions';

export async function generateMetadata() {
  const [t, common] = await Promise.all([getMessages(authMessages), getMessages(commonMessages)]);
  return { title: common.title(t.titles.resetPassword) };
}

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Only show the form; the link is used up when the new password is saved (mail scanners may open it first).
  if (!(await isEmailTokenValid(getDb(), token, 'reset_password'))) {
    const t = (await getMessages(authMessages)).reset;
    return (
      <div className="card stack auth-card">
        <h1>{t.linkGone}</h1>
        <p className="muted">{t.linkRules}</p>
        <Link className="button" href="/forgot-password">{t.sendNewLink}</Link>
      </div>
    );
  }
  return <ResetPasswordForm action={resetPasswordAction.bind(null, token)} />;
}
