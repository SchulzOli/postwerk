import { afterEach, describe, expect, it, vi } from 'vitest';
import { googleBusiness, type GoogleBusinessCredentials } from '../src/google-business';
import type { OAuthConnect } from '../src/types';
import { mockFetch } from './helpers';

const client = { clientId: 'cid', clientSecret: 'secret' };
const credentials: GoogleBusinessCredentials = { accessToken: 'tok', refreshToken: 'rt', location: 'accounts/1/locations/10', languageCode: 'de' };
const connector = googleBusiness.connector as OAuthConnect<GoogleBusinessCredentials>;
const content = (text: string, media: { url: string; kind: 'image' }[] = []) => ({ text, media, options: {} });
const POSTS = 'https://mybusiness.googleapis.com/v4/accounts/1/locations/10/localPosts';

afterEach(() => vi.unstubAllGlobals());

describe('google business profile', () => {
  it('asks for the business.manage scope', () => {
    const url = new URL(connector.authorizeUrl(client, { redirectUri: 'https://app/cb', state: 's' }));
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/business.manage');
    expect(url.searchParams.get('access_type')).toBe('offline');
  });

  it('returns one account per location across accounts and pages', async () => {
    const calls = mockFetch([
      ['POST https://oauth2.googleapis.com/token', () => ({ access_token: 'tok', refresh_token: 'rt', expires_in: 3599 })],
      ['GET https://mybusinessaccountmanagement.googleapis.com/v1/accounts', () => ({ accounts: [{ name: 'accounts/1' }, { name: 'accounts/2' }] })],
      [
        'GET https://mybusinessbusinessinformation.googleapis.com/v1/accounts/1/locations',
        (call) =>
          call.url.includes('pageToken=p2')
            ? { locations: [{ name: 'locations/11', title: 'Praxis Mitte', languageCode: 'en' }] }
            : {
                locations: [{ name: 'locations/10', title: 'Praxis Nord', storefrontAddress: { addressLines: ['Hauptstr. 1'], locality: 'Berlin' } }],
                nextPageToken: 'p2',
              },
      ],
      // Location 10 is also visible through a location group; it must not appear twice.
      ['GET https://mybusinessbusinessinformation.googleapis.com/v1/accounts/2/locations', () => ({ locations: [{ name: 'locations/10', title: 'Praxis Nord' }] })],
    ]);
    const accounts = await connector.exchange(client, { code: 'c', redirectUri: 'https://app/cb' });
    expect(accounts.map((account) => account.profile)).toEqual([
      { externalId: 'locations/10', handle: 'Hauptstr. 1, Berlin', displayName: 'Praxis Nord' },
      { externalId: 'locations/11', handle: 'Praxis Mitte', displayName: 'Praxis Mitte' },
    ]);
    expect(accounts.map((account) => account.credentials)).toEqual([
      expect.objectContaining({ accessToken: 'tok', refreshToken: 'rt', location: 'accounts/1/locations/10', languageCode: 'de' }),
      expect.objectContaining({ location: 'accounts/1/locations/11', languageCode: 'en' }),
    ]);
    expect(calls[2]!.url).toContain('readMask=name%2Ctitle%2ClanguageCode%2CstorefrontAddress');
  });

  it('fails clearly when there are no locations', async () => {
    mockFetch([
      ['POST https://oauth2.googleapis.com/token', () => ({ access_token: 'tok' })],
      ['GET https://mybusinessaccountmanagement.googleapis.com/v1/accounts', () => ({ accounts: [{ name: 'accounts/1' }] })],
      ['GET https://mybusinessbusinessinformation.googleapis.com/v1/accounts/1/locations', () => ({})],
    ]);
    await expect(connector.exchange(client, { code: 'c', redirectUri: 'x' })).rejects.toThrow(/No Business Profile locations/);
  });

  it('publishes a text update', async () => {
    const calls = mockFetch([['POST ' + POSTS, () => ({ name: 'accounts/1/locations/10/localPosts/99', searchUrl: 'https://local.google.com/place?id=1' })]]);
    const result = await googleBusiness.publish(credentials, content('Neue Öffnungszeiten'), { idempotencyKey: 'k' });
    expect(result).toEqual({ remoteId: 'accounts/1/locations/10/localPosts/99', url: 'https://local.google.com/place?id=1' });
    expect(calls[0]!.headers.authorization).toBe('Bearer tok');
    expect(calls[0]!.body).toEqual({ languageCode: 'de', summary: 'Neue Öffnungszeiten', topicType: 'STANDARD' });
  });

  it('attaches a photo by URL', async () => {
    const calls = mockFetch([['POST ' + POSTS, () => ({ name: 'accounts/1/locations/10/localPosts/100' })]]);
    await googleBusiness.publish(credentials, content('Team', [{ url: 'https://cdn.example/team.jpg', kind: 'image' }]), { idempotencyKey: 'k' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({ media: [{ mediaFormat: 'PHOTO', sourceUrl: 'https://cdn.example/team.jpg' }] });
  });

  it('maps errors', async () => {
    mockFetch([['POST ' + POSTS, () => new Response(JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' } }), { status: 429 })]]);
    await expect(googleBusiness.publish(credentials, content('x'), { idempotencyKey: 'k' })).rejects.toMatchObject({ retryable: true, needsReauth: false });
    mockFetch([['POST ' + POSTS, () => new Response(JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'The caller does not have permission' } }), { status: 403 })]]);
    await expect(googleBusiness.publish(credentials, content('x'), { idempotencyKey: 'k' })).rejects.toMatchObject({ needsReauth: true });
    mockFetch([
      [
        'POST ' + POSTS,
        () =>
          new Response(JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'API has not been used', details: [{ reason: 'SERVICE_DISABLED' }] } }), {
            status: 403,
          }),
      ],
    ]);
    await expect(googleBusiness.publish(credentials, content('x'), { idempotencyKey: 'k' })).rejects.toMatchObject({ needsReauth: false, retryable: false });
  });

  it('refreshes tokens', async () => {
    expect(googleBusiness.needsRefresh!({ ...credentials, expiresAt: 0 }, Date.now())).toBe(true);
    mockFetch([['POST https://oauth2.googleapis.com/token', () => ({ access_token: 'new', refresh_token: 'rt2', expires_in: 3599 })]]);
    expect(await googleBusiness.refresh!(credentials, client)).toMatchObject({ accessToken: 'new', refreshToken: 'rt2', location: 'accounts/1/locations/10' });
    await expect(googleBusiness.refresh!(credentials, undefined)).rejects.toMatchObject({ retryable: true });
  });
});
