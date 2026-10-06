'use client';

import { useState, useTransition } from 'react';
import { resendVerificationAction, type AccountState } from '@/app/(app)/account/actions';
import { useMessages } from '@/lib/i18n';
import { accountMessages } from '@/messages/account';

/** Reminds the user to confirm their email address, with a resend button. */
export function VerifyBanner({ email, className = '' }: { email: string; className?: string }) {
  const [state, setState] = useState<AccountState>({});
  const [pending, startTransition] = useTransition();
  const t = useMessages(accountMessages);
  return (
    <div className={`verify-banner ${className}`} role="status">
      <span>
        {t.verifyBefore}<strong>{email}</strong>{t.verifyAfter}
      </span>
      <button type="button" className="link" disabled={pending || Boolean(state.success)} onClick={() => startTransition(async () => setState(await resendVerificationAction()))}>
        {state.success ? t.sent : t.sendAgain}
      </button>
      {state.error && <small className="error">{state.error}</small>}
    </div>
  );
}
