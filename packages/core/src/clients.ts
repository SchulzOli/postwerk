import { getProviderInfo, type OAuthClient, type ProviderId } from '@postwerk/providers';

type Env = Record<string, string | undefined>;

/**
 * The operator's developer app for a network, read from
 * `${PREFIX}_CLIENT_ID` / `${PREFIX}_CLIENT_SECRET`. Undefined when not configured.
 */
export function oauthClientFor(id: ProviderId, env: Env = process.env): OAuthClient | undefined {
  const prefix = getProviderInfo(id).setup.envPrefix;
  if (!prefix) return undefined;
  const clientId = env[`${prefix}_CLIENT_ID`]?.trim();
  const clientSecret = env[`${prefix}_CLIENT_SECRET`]?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

/** Whether users of this server can connect the network right now. */
export function isProviderAvailable(id: ProviderId, env: Env = process.env): boolean {
  if (id === 'sandbox') return env.ENABLE_SANDBOX === 'true';
  return getProviderInfo(id).setup.operator === 'none' || oauthClientFor(id, env) !== undefined;
}
