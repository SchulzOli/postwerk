import { describe, expect, it } from 'vitest';
import { dataProcessors, legalPages, offeredNetworks, operatorDetails } from '../src/legal';

const operator = { OPERATOR_NAME: 'Oli Schulz', OPERATOR_EMAIL: 'hallo@example.com' };

describe('legal pages', () => {
  it('needs the operator’s name and email before showing built-in pages', () => {
    expect(operatorDetails({})).toBeNull();
    expect(legalPages({})).toEqual({ privacy: null, terms: null, imprint: null, 'data-deletion': null });
    expect(legalPages(operator)).toEqual({
      privacy: { href: '/legal/privacy', builtIn: true },
      terms: { href: '/legal/terms', builtIn: true },
      imprint: null,
      'data-deletion': { href: '/legal/data-deletion', builtIn: true },
    });
  });

  it('shows the imprint with an address and prefers the operator’s own pages', () => {
    const env = { ...operator, OPERATOR_ADDRESS: 'Praxis Schulz; Hauptstr. 1\\n12345 Berlin', LEGAL_PRIVACY_URL: 'https://example.com/datenschutz' };
    expect(operatorDetails(env)?.address).toEqual(['Praxis Schulz', 'Hauptstr. 1', '12345 Berlin']);
    expect(legalPages(env)).toMatchObject({
      privacy: { href: 'https://example.com/datenschutz', builtIn: false },
      imprint: { href: '/legal/imprint', builtIn: true },
    });
    // An own imprint works without OPERATOR_* at all.
    expect(legalPages({ LEGAL_IMPRINT_URL: 'https://example.com/impressum' }).imprint).toEqual({ href: 'https://example.com/impressum', builtIn: false });
  });

  it('names the service providers the settings use', () => {
    expect(dataProcessors({})).toEqual([]);
    expect(
      dataProcessors({
        OPERATOR_HOSTING: 'Hetzner Online GmbH, Germany',
        MEDIA_STORAGE: 's3',
        S3_ENDPOINT: 'https://fsn1.your-objectstorage.com',
        SMTP_URL: 'smtp://user:secret@smtp.example.com:587',
        ZERNIO_API_KEY: 'zk',
      }),
    ).toEqual([
      { kind: 'hosting', name: 'Hetzner Online GmbH, Germany' },
      { kind: 'storage', name: 'fsn1.your-objectstorage.com' },
      { kind: 'mail', name: 'smtp.example.com' },
      { kind: 'bridge', name: 'Zernio (ARBICHAT, S.L., Palamós (Girona), Spain)', privacyUrl: 'https://zernio.com/privacy-policy' },
    ]);
  });

  it('lists the networks people can connect here', () => {
    const ids = (env: Record<string, string>) => offeredNetworks(env).map(({ info, viaBridge }) => `${info.id}${viaBridge ? ' (bridge)' : ''}`);
    expect(ids({ ENABLE_SANDBOX: 'true' })).toEqual(['mastodon', 'bluesky', 'telegram', 'discord']);
    expect(ids({ HIDE_NETWORKS: 'telegram,discord' })).toEqual(['mastodon', 'bluesky']);
    expect(ids({ ZERNIO_API_KEY: 'zk', ZERNIO_NETWORKS: 'instagram', LINKEDIN_CLIENT_ID: 'id', LINKEDIN_CLIENT_SECRET: 's' })).toEqual([
      'mastodon',
      'bluesky',
      'instagram (bridge)',
      'linkedin',
      'linkedin_page',
      'telegram',
      'discord',
    ]);
  });
});
