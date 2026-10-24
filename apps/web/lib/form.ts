import { startTransition, type FormEvent } from 'react';

/**
 * Submits a form to a `useActionState` action without React's automatic form
 * reset, so what people typed stays when the server says what to fix.
 * Forms that should empty after a save reset themselves.
 */
export function keepValues(action: (form: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter);
    startTransition(() => action(form));
  };
}
