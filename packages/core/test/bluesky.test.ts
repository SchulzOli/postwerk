import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, serverSecrets, type Database } from '@postwerk/db';
import { runMigrations } from '../../db/src/migrate';
import { blueskyClientIds, blueskyClientMetadata, blueskyJwks, blueskyKeyset, finishBlueskyLogin } from '../src/bluesky';
import { decryptJson, encrypt } from '../src/crypto';

describe('Bluesky OAuth client', () => {
  it('is a confidential client on https', () => {
    expect(blueskyClientIds('https://postwerk.example/')).toEqual({
      clientId: 'https://postwerk.example/oauth/bluesky/client-metadata.json',
      redirectUri: 'https://postwerk.example/api/connect/bluesky/callback',
      confidential: true,
    });
    expect(blueskyClientMetadata('https://postwerk.example')).toMatchObject({
      client_id: 'https://postwerk.example/oauth/bluesky/client-metadata.json',
      redirect_uris: ['https://postwerk.example/api/connect/bluesky/callback'],
      scope: 'atproto transition:generic',
      token_endpoint_auth_method: 'private_key_jwt',
      token_endpoint_auth_signing_alg: 'ES256',
      jwks_uri: 'https://postwerk.example/oauth/bluesky/jwks.json',
      dpop_bound_access_tokens: true,
    });
  });

  it('is a loopback client during local development', () => {
    const ids = blueskyClientIds('http://localhost:3000')!;
    expect(ids.confidential).toBe(false);
    expect(ids.redirectUri).toBe('http://127.0.0.1:3000/api/connect/bluesky/callback');
    const params = new URL(ids.clientId).searchParams;
    expect(ids.clientId.startsWith('http://localhost?')).toBe(true);
    expect([params.get('redirect_uri'), params.get('scope')]).toEqual([ids.redirectUri, 'atproto transition:generic']);
    expect(blueskyClientMetadata('http://localhost:3000')).toBeUndefined();
  });

  it('is not available on plain http elsewhere', () => {
    expect(blueskyClientIds('http://192.168.1.20:3000')).toBeUndefined();
    expect(blueskyClientIds('not a url')).toBeUndefined();
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('Bluesky OAuth keys (Postgres)', () => {
  let db: Database;
  beforeAll(async () => {
    await runMigrations(url);
    db = createDb(url);
  });
  afterAll(async () => db?.close());
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE server_secrets`);
  });

  it('creates one signing key and keeps it encrypted', async () => {
    const [first, again] = await Promise.all([blueskyKeyset(db), blueskyKeyset(db)]);
    expect(first.keys).toHaveLength(1);
    expect(again.keys[0]).toEqual(first.keys[0]);
    expect(first.keys[0]).toMatchObject({ kty: 'EC', crv: 'P-256', d: expect.any(String), kid: expect.any(String) });
    const [row] = await db.select().from(serverSecrets);
    expect(row!.valueEnc).not.toContain(first.keys[0]!.d!);
    const jwks = await blueskyJwks(db);
    expect(jwks.keys).toEqual([expect.objectContaining({ kid: first.keys[0]!.kid, x: first.keys[0]!.x })]);
    expect(jwks.keys[0]).not.toHaveProperty('d');
  });

  it('replaces a key it can no longer read', async () => {
    await db.insert(serverSecrets).values({ name: 'bluesky-oauth-key', valueEnc: encrypt('{}', Buffer.alloc(32, 7).toString('base64')) });
    const { keys } = await blueskyKeyset(db);
    expect(keys[0]!.d).toBeDefined();
    const [row] = await db.select().from(serverSecrets).where(eq(serverSecrets.name, 'bluesky-oauth-key'));
    expect(decryptJson(row!.valueEnc)).toEqual(keys[0]);
  });

  it('turns a tampered sign-in state into a plain error', async () => {
    await expect(finishBlueskyLogin(db, { pending: 'garbage' }, { code: 'c', iss: null })).rejects.toThrow('This sign-in link has expired. Please try again.');
  });
});
