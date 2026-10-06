'use client';

import { useState, useTransition } from 'react';
import { resendVerificationAction, type AccountState } from '@/app/(app)/account/actions';

/** Reminds the user to confirm their email address, with a resend button. */
export function VerifyBanner({ email, className = '' }: { email: string; className?: string }) {
  const [state, setState] = useState<AccountState>({});
  const [pending, startTransition] = useTransition();
  return (
    <div className={`verify-banner ${className}`} role="status">
      <span>
        Please confirm your email address — we sent a link to <strong>{email}</strong>.
      </span>
      <button type="button" className="link" disabled={pending || Boolean(state.success)} onClick={() => startTransition(async () => setState(await resendVerificationAction()))}>
        {state.success ? 'Sent' : 'Send again'}
      </button>
      {state.error && <small className="error">{state.error}</small>}
    </div>
  );
}
