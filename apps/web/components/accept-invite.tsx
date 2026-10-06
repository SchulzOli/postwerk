'use client';

import { useState, useTransition } from 'react';
import { acceptInviteAction } from '@/app/(app)/team/actions';

export function AcceptInvite({ token, label }: { token: string; label: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <>
      <button type="button" disabled={pending} onClick={() => startTransition(async () => setError((await acceptInviteAction(token)).error))}>
        {pending ? 'Joining…' : label}
      </button>
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}
