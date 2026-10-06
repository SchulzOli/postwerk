'use client';

import { useActionState } from 'react';
import type { ConnectState } from '@/app/(app)/accounts/actions';

interface Field {
  name: string;
  label: string;
  placeholder?: string;
  type?: string;
  hint?: React.ReactNode;
  autoComplete?: string;
}

interface Props {
  action: (state: ConnectState, form: FormData) => Promise<ConnectState>;
  fields: Field[];
  submitLabel: string;
  /** Less prominent button, for a fallback way to connect. */
  secondary?: boolean;
}

export function ConnectForm({ action, fields, submitLabel, secondary }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="stack">
      {fields.map((field) => (
        <label key={field.name}>
          {field.label}
          <input name={field.name} type={field.type ?? 'text'} placeholder={field.placeholder} autoComplete={field.autoComplete ?? 'off'} defaultValue={field.type === 'password' ? undefined : state.values?.[field.name]} required />
          {field.hint && <small className="muted">{field.hint}</small>}
        </label>
      ))}
      {state.error && <p className="error" role="alert">{state.error}</p>}
      {state.success && <p className="success" role="status">{state.success}</p>}
      <button type="submit" className={secondary ? 'secondary' : undefined} disabled={pending}>{pending ? 'Connecting…' : submitLabel}</button>
    </form>
  );
}
