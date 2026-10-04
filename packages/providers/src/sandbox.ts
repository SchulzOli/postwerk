import { randomUUID } from 'node:crypto';
import { ProviderError, type Provider } from './types';

/**
 * A fake network for local development and tests. Posts are only logged.
 * Text containing "#fail" fails permanently, "#flaky" fails with a retryable error.
 */
export interface SandboxCredentials {
  name: string;
}

export const sandbox: Provider<SandboxCredentials> = {
  id: 'sandbox',
  name: 'Sandbox',
  validate(content) {
    return content.text.trim() ? [] : ['Text is empty.'];
  },
  async publish(credentials, content, context) {
    if (content.text.includes('#fail')) throw new ProviderError('Sandbox rejected the post (#fail).');
    if (content.text.includes('#flaky')) throw new ProviderError('Sandbox is temporarily unavailable (#flaky).', { retryable: true });
    console.log(`[sandbox:${credentials.name}] ${context.idempotencyKey}: ${content.text}`);
    return { remoteId: randomUUID() };
  },
};
