'use client';

import type { FormField } from '@postwerk/providers/catalog';
import { connectBluesky, connectWithForm } from '@/app/(app)/accounts/actions';
import { useMessages } from '@/lib/i18n';
import { networksMessages } from '@/messages/networks';
import { ConnectForm } from './connect-form';

/** Sign in on the user's Bluesky server (OAuth), with app passwords as the fallback. */
export function BlueskyConnect({ fields, oauth }: { fields: FormField[]; oauth: boolean }) {
  const t = useMessages(networksMessages);
  const appPassword = <ConnectForm action={connectWithForm.bind(null, 'bluesky')} submitLabel={t.bluesky.connectWithAppPassword} fields={fields} secondary={oauth} />;
  if (!oauth) {
    return (
      <div className="stack-sm">
        {appPassword}
        <small className="muted">{t.bluesky.needsHttps}</small>
      </div>
    );
  }
  return (
    <div className="stack">
      <ConnectForm
        action={connectBluesky}
        submitLabel={t.continueTo('Bluesky')}
        fields={[{ name: 'handle', label: fields.find((field) => field.name === 'handle')?.label ?? 'Handle', placeholder: t.bluesky.placeholder, hint: t.bluesky.handleHint }]}
      />
      <details className="stack-sm">
        <summary className="small-link">{t.bluesky.appPassword}</summary>
        {appPassword}
      </details>
    </div>
  );
}
