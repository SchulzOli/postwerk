'use client';

import { useState, useTransition } from 'react';
import { acceptInviteAction } from '@/app/(app)/team/actions';
import { useMessages } from '@/lib/i18n';
import { authMessages } from '@/messages/auth';

export function AcceptInvite({ token, label }: { token: string; label: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const t = useMessages(authMessages).invite;
  return (
    <>
      <button type="button" disabled={pending} onClick={() => startTransition(async () => setError((await acceptInviteAction(token)).error))}>
        {pending ? t.joining : label}
      </button>
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}
