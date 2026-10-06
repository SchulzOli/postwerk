import Link from 'next/link';
import { isEmailTokenValid } from '@postwerk/core';
import { getDb } from '@postwerk/db';
import { ResetPasswordForm } from '@/components/password-forms';
import { resetPasswordAction } from '../../actions';

export const metadata = { title: 'Choose a new password · Postwerk' };

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Only show the form; the link is used up when the new password is saved (mail scanners may open it first).
  if (!(await isEmailTokenValid(getDb(), token, 'reset_password'))) {
    return (
      <div className="card stack auth-card">
        <h1>This link does not work anymore</h1>
        <p className="muted">Reset links work for one hour and only once.</p>
        <Link className="button" href="/forgot-password">Send a new link</Link>
      </div>
    );
  }
  return <ResetPasswordForm action={resetPasswordAction.bind(null, token)} />;
}
