import { catalog } from './catalog';
import { ProviderError, type Provider } from './types';

/**
 * A fake network for local development and tests. Posts are only logged.
 * Text containing "#fail" fails permanently, "#flaky" fails with a retryable error.
 */
export interface SandboxCredentials {
  name: string;
}

export const sandbox: Provider<SandboxCredentials> = {
  ...catalog.sandbox,
  connector: {
    kind: 'form',
    fields: [{ name: 'name', label: 'Name', placeholder: 'test' }],
    async connect(values) {
      const name = values.name?.trim() || 'sandbox';
      return [{ profile: { externalId: name, handle: `@${name}` }, credentials: { name } }];
    },
  },
  async publish(credentials, content, context) {
    if (content.text.includes('#fail')) throw new ProviderError('Sandbox rejected the post (#fail).');
    if (content.text.includes('#flaky')) throw new ProviderError('Sandbox is temporarily unavailable (#flaky).', { retryable: true });
    const media = content.media.length > 0 ? ` [+${content.media.length} media]` : '';
    console.log(`[sandbox:${credentials.name}] ${context.idempotencyKey}: ${content.text}${media}`);
    return { remoteId: crypto.randomUUID() };
  },
};
