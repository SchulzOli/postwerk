import { describe, expect, it } from 'vitest';
import { provider } from '@postwerk/db';
import { PROVIDER_IDS } from '@postwerk/providers';
import { isProviderAvailable, oauthClientFor } from '../src/clients';

describe('operator apps', () => {
  it('reads client credentials from prefixed env vars', () => {
    const env = { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' };
    expect(oauthClientFor('youtube', env)).toEqual({ clientId: 'id', clientSecret: 'secret' });
    expect(oauthClientFor('google_business', env)).toEqual({ clientId: 'id', clientSecret: 'secret' });
    expect(oauthClientFor('instagram', env)).toBeUndefined();
    expect(oauthClientFor('mastodon', env)).toBeUndefined();
  });

  it('knows which networks can be connected', () => {
    expect(isProviderAvailable('mastodon', {})).toBe(true);
    expect(isProviderAvailable('telegram', {})).toBe(true);
    expect(isProviderAvailable('instagram', {})).toBe(false);
    expect(isProviderAvailable('instagram', { INSTAGRAM_CLIENT_ID: 'a', INSTAGRAM_CLIENT_SECRET: 'b' })).toBe(true);
    expect(isProviderAvailable('sandbox', {})).toBe(false);
    expect(isProviderAvailable('sandbox', { ENABLE_SANDBOX: 'true' })).toBe(true);
  });

  it('keeps the database enum in sync with the provider list', () => {
    expect([...provider.enumValues]).toEqual([...PROVIDER_IDS]);
  });
});
