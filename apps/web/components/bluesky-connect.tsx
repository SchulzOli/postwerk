'use client';

import type { FormField } from '@postwerk/providers/catalog';
import { connectBluesky, connectWithForm } from '@/app/(app)/accounts/actions';
import { ConnectForm } from './connect-form';

/** Sign in on the user's Bluesky server (OAuth), with app passwords as the fallback. */
export function BlueskyConnect({ fields, oauth }: { fields: FormField[]; oauth: boolean }) {
  const appPassword = <ConnectForm action={connectWithForm.bind(null, 'bluesky')} submitLabel="Connect with app password" fields={fields} secondary={oauth} />;
  if (!oauth) {
    return (
      <div className="stack-sm">
        {appPassword}
        <small className="muted">Signing in on Bluesky itself needs Postwerk on an https address (APP_URL).</small>
      </div>
    );
  }
  return (
    <div className="stack">
      <ConnectForm
        action={connectBluesky}
        submitLabel="Continue to Bluesky"
        fields={[{ name: 'handle', label: 'Handle', placeholder: 'you.bsky.social', hint: 'You sign in on your Bluesky server; Postwerk never sees your password.' }]}
      />
      <details className="stack-sm">
        <summary className="small-link">Use an app password instead</summary>
        {appPassword}
      </details>
    </div>
  );
}
