import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { atprotoNetwork, finishLogin, generateSigningKey, publicJwk, refreshSession, resolveDid, startLogin, type AtprotoClient } from '../src/atproto';
import { bluesky, type BlueskyOAuth } from '../src/bluesky';
import { ProviderError, type PrivateJwk } from '../src/types';

/**
 * A fake AT Protocol network behind a stubbed fetch: a PLC directory, an
 * AppView, a PDS and its authorization server. The fakes check what real
 * servers check: DPoP proofs (signature, method, URL, nonce, token binding),
 * client assertions, PKCE and single-use refresh tokens.
 */
const PDS = 'https://pds.test';
const AUTH = 'https://auth.test';
const DID = 'did:plc:abcdefghijklmnopqrstuvwx';
const OTHER_DID = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const CLIENT_ID = 'https://app.test/oauth/bluesky/client-metadata.json';
const REDIRECT = 'https://app.test/api/connect/bluesky/callback';

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString());
const sha256 = async (text: string) => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).toString('base64url');

async function verifyJwt(token: string, jwk: { kty?: string; crv?: string; x?: string; y?: string }) {
  const [header, payload, signature] = token.split('.');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(signature!, 'base64url'), new TextEncoder().encode(`${header}.${payload}`));
  if (!valid) throw new Error('invalid signature');
  return { header: decode(header!), payload: decode(payload!) };
}

interface Fake {
  clientKey?: PrivateJwk;
  /** Who the sign-in server says signed in. */
  signedIn: string;
  /** Which server a DID's document points to. */
  pdsOf: Record<string, string>;
  pars: Map<string, { params: URLSearchParams; jkt: string }>;
  codes: Map<string, { params: URLSearchParams; jkt: string }>;
  refreshTokens: Map<string, string>;
  accessTokens: Map<string, string>;
  log: string[];
  records: unknown[];
  nonce: { auth: string; pds: string };
}

let fake: Fake;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers });

/** Checks a DPoP proof like a server would; returns the key's "thumbprint" or an error response. */
async function checkDpop(request: Request, nonce: string, accessToken?: string): Promise<string | Response> {
  const proof = request.headers.get('dpop');
  if (!proof) return json({ error: 'invalid_dpop_proof' }, 400);
  const { header, payload } = await verifyJwt(proof, decode(proof.split('.')[0]!).jwk);
  expect(header).toMatchObject({ typ: 'dpop+jwt', alg: 'ES256' });
  expect(header.jwk.d).toBeUndefined();
  expect(payload.htm).toBe(request.method);
  expect(payload.htu).toBe(request.url.split('?')[0]);
  expect(Math.abs(payload.iat - Date.now() / 1000)).toBeLessThan(60);
  if (accessToken) expect(payload.ath).toBe(await sha256(accessToken));
  if (payload.nonce !== nonce) {
    return accessToken
      ? new Response('', { status: 401, headers: { 'www-authenticate': 'DPoP error="use_dpop_nonce"', 'dpop-nonce': nonce } })
      : json({ error: 'use_dpop_nonce' }, 400, { 'dpop-nonce': nonce });
  }
  return `${header.jwk.x}.${header.jwk.y}`;
}

async function checkClient(params: URLSearchParams) {
  expect(params.get('client_id')).toEqual(fake.clientKey ? CLIENT_ID : expect.stringMatching(/^http:\/\/localhost\?/));
  if (!fake.clientKey) return expect(params.get('client_assertion')).toBeNull();
  expect(params.get('client_assertion_type')).toBe('urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
  const { header, payload } = await verifyJwt(params.get('client_assertion')!, fake.clientKey);
  expect(header.kid).toBe(fake.clientKey.kid);
  expect(payload).toMatchObject({ iss: CLIENT_ID, sub: CLIENT_ID, aud: AUTH });
  expect(payload.exp).toBeGreaterThan(Date.now() / 1000);
}

function didDoc(did: string) {
  return {
    id: did,
    alsoKnownAs: did === DID ? ['at://alice.test'] : ['at://mallory.test'],
    service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: fake.pdsOf[did] ?? PDS }],
  };
}

async function route(request: Request): Promise<Response> {
  const url = new URL(request.url);
  fake.log.push(`${request.method} ${url.origin}${url.pathname}`);
  const key = `${request.method} ${url.origin}${url.pathname}`;
  switch (key) {
    case 'GET https://appview.test/xrpc/com.atproto.identity.resolveHandle':
      return url.searchParams.get('handle') === 'alice.test' ? json({ did: DID }) : json({ error: 'InvalidRequest', message: 'Unable to resolve handle' }, 400);
    case 'GET https://appview.test/xrpc/app.bsky.actor.getProfile':
      return json({ did: DID, handle: 'alice.test', displayName: 'Alice', avatar: 'https://cdn.test/a.jpg' });
    case `GET https://plc.test/${DID}`:
      return json(didDoc(DID));
    case `GET https://plc.test/${OTHER_DID}`:
      return json(didDoc(OTHER_DID));
    case `GET ${PDS}/.well-known/oauth-protected-resource`:
      return json({ resource: PDS, authorization_servers: [AUTH] });
    case 'GET https://evil-pds.test/.well-known/oauth-protected-resource':
      return json({ resource: 'https://evil-pds.test', authorization_servers: ['https://evil-pds.test'] });
    case 'GET https://evil-pds.test/.well-known/oauth-authorization-server':
    case `GET ${AUTH}/.well-known/oauth-authorization-server`: {
      const issuer = url.origin;
      return json({
        issuer,
        authorization_endpoint: `${issuer}/oauth/authorize`,
        token_endpoint: `${issuer}/oauth/token`,
        pushed_authorization_request_endpoint: `${issuer}/oauth/par`,
        dpop_signing_alg_values_supported: ['ES256'],
        token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
        authorization_response_iss_parameter_supported: true,
        client_id_metadata_document_supported: true,
      });
    }
    case `POST ${AUTH}/oauth/par`: {
      const jkt = await checkDpop(request, fake.nonce.auth);
      if (jkt instanceof Response) return jkt;
      const params = new URLSearchParams(await request.text());
      await checkClient(params);
      const requestUri = `urn:ietf:params:oauth:request_uri:${fake.pars.size + 1}`;
      fake.pars.set(requestUri, { params, jkt });
      return json({ request_uri: requestUri, expires_in: 300 }, 201);
    }
    case `POST ${AUTH}/oauth/token`: {
      const jkt = await checkDpop(request, fake.nonce.auth);
      if (jkt instanceof Response) return jkt;
      const params = new URLSearchParams(await request.text());
      await checkClient(params);
      let did: string;
      if (params.get('grant_type') === 'authorization_code') {
        const grant = fake.codes.get(params.get('code')!);
        fake.codes.delete(params.get('code')!);
        if (!grant || grant.jkt !== jkt || grant.params.get('redirect_uri') !== params.get('redirect_uri')) return json({ error: 'invalid_grant' }, 400);
        if ((await sha256(params.get('code_verifier')!)) !== grant.params.get('code_challenge')) return json({ error: 'invalid_grant', error_description: 'PKCE failed' }, 400);
        did = fake.signedIn;
      } else {
        const owner = fake.refreshTokens.get(params.get('refresh_token')!);
        // Refresh tokens are single-use.
        fake.refreshTokens.delete(params.get('refresh_token')!);
        if (!owner || owner.split('|')[1] !== jkt) return json({ error: 'invalid_grant', error_description: 'refresh token replayed' }, 400);
        did = owner.split('|')[0]!;
      }
      const n = fake.accessTokens.size + 1;
      fake.accessTokens.set(`at-${n}`, `${did}|${jkt}`);
      fake.refreshTokens.set(`rt-${n}`, `${did}|${jkt}`);
      return json({ access_token: `at-${n}`, refresh_token: `rt-${n}`, token_type: 'DPoP', expires_in: 900, scope: 'atproto transition:generic', sub: did });
    }
    case `POST ${PDS}/xrpc/com.atproto.repo.createRecord`: {
      const token = request.headers.get('authorization')?.replace(/^DPoP /, '') ?? '';
      const jkt = await checkDpop(request, fake.nonce.pds, token);
      if (jkt instanceof Response) return jkt;
      if (fake.accessTokens.get(token) !== `${DID}|${jkt}`) return json({ error: 'InvalidToken' }, 401);
      fake.records.push(await request.json());
      return json({ uri: `at://${DID}/app.bsky.feed.post/3jzfcijpj2z2a`, cid: 'bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm' });
    }
  }
  return json({ error: `no fake for ${key}` }, 404);
}

/** The user approves the request on the sign-in page; the server issues a code. */
function approve(authorizeUrl: string): string {
  const requestUri = new URL(authorizeUrl).searchParams.get('request_uri')!;
  const grant = fake.pars.get(requestUri)!;
  const code = `code-${requestUri.split(':').pop()}`;
  fake.codes.set(code, grant);
  return code;
}

const saved = { ...atprotoNetwork };
beforeEach(async () => {
  Object.assign(atprotoNetwork, { plcDirectory: 'https://plc.test', appView: 'https://appview.test' });
  fake = {
    clientKey: await generateSigningKey('k1'),
    signedIn: DID,
    pdsOf: {},
    pars: new Map(),
    codes: new Map(),
    refreshTokens: new Map(),
    accessTokens: new Map(),
    log: [],
    records: [],
    nonce: { auth: 'auth-nonce-1', pds: 'pds-nonce-1' },
  };
  vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => route(new Request(input, init))));
});
afterEach(() => {
  Object.assign(atprotoNetwork, saved);
  vi.unstubAllGlobals();
});

const confidential = (): AtprotoClient => ({ clientId: CLIENT_ID, redirectUri: REDIRECT, keys: [fake.clientKey!] });

async function signIn(client = confidential()) {
  const { url, pending } = await startLogin(client, '@Alice.test', 'state-1');
  return finishLogin(client.keys, pending, { code: approve(url), iss: AUTH });
}

describe('AT Protocol OAuth', () => {
  it('finds the sign-in server from a handle and pushes the request there', async () => {
    const { url, pending } = await startLogin(confidential(), '@Alice.test', 'state-1');
    expect(url).toBe(`${AUTH}/oauth/authorize?client_id=${encodeURIComponent(CLIENT_ID)}&request_uri=${encodeURIComponent('urn:ietf:params:oauth:request_uri:1')}`);
    const { params } = fake.pars.get('urn:ietf:params:oauth:request_uri:1')!;
    expect(Object.fromEntries(params)).toMatchObject({
      response_type: 'code',
      redirect_uri: REDIRECT,
      scope: 'atproto transition:generic',
      state: 'state-1',
      code_challenge_method: 'S256',
      login_hint: 'alice.test',
    });
    // The first request had no nonce; the server handed one out and it was retried.
    expect(fake.log.filter((line) => line === `POST ${AUTH}/oauth/par`)).toHaveLength(2);
    expect(pending).toMatchObject({ issuer: AUTH, clientId: CLIENT_ID, kid: 'k1', dpop: { nonce: 'auth-nonce-1' } });
  });

  it('signs in and binds the tokens to its DPoP key', async () => {
    const session = await signIn();
    expect(session).toMatchObject({ did: DID, pds: PDS, issuer: AUTH, handle: 'alice.test', accessToken: 'at-1', refreshToken: 'rt-1', clientId: CLIENT_ID, kid: 'k1' });
    expect(session.expiresAt).toBeGreaterThan(Date.now() + 800_000);
  });

  it('rejects a callback from another server', async () => {
    const client = confidential();
    const { url, pending } = await startLogin(client, 'alice.test', 's');
    await expect(finishLogin(client.keys, pending, { code: approve(url), iss: 'https://evil.test' })).rejects.toThrow(/different server/);
  });

  it('rejects accounts the sign-in server does not manage', async () => {
    // The server claims a DID whose data server trusts another sign-in server.
    fake.signedIn = OTHER_DID;
    fake.pdsOf[OTHER_DID] = 'https://evil-pds.test';
    await expect(signIn()).rejects.toThrow(/not managed by the server/);
  });

  it('works as a loopback client without a key (development)', async () => {
    fake.clientKey = undefined;
    const session = await signIn({ clientId: 'http://localhost?redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2Fcb&scope=atproto+transition%3Ageneric', redirectUri: 'http://127.0.0.1:3000/cb', keys: [] });
    expect(session.did).toBe(DID);
    expect(session.kid).toBeUndefined();
  });

  it('refreshes with single-use refresh tokens', async () => {
    const session = await signIn();
    const refreshed = await refreshSession(session, [fake.clientKey!]);
    expect(refreshed).toMatchObject({ did: DID, accessToken: 'at-2', refreshToken: 'rt-2', dpopKey: session.dpopKey });
    // The old refresh token is gone: the account must be reconnected.
    const error = await refreshSession(session, [fake.clientKey!]).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ needsReauth: true });
  });

  it('asks for a reconnect when the client key changed', async () => {
    const session = await signIn();
    await expect(refreshSession(session, [await generateSigningKey('k2')])).rejects.toMatchObject({ needsReauth: true });
  });

  it('publishes through the PDS with DPoP-bound tokens', async () => {
    const credentials: BlueskyOAuth = { kind: 'oauth', ...(await signIn()) };
    const result = await bluesky.publish(credentials, { text: 'Hello from Postwerk', media: [], options: {} }, { idempotencyKey: 'k' });
    expect(result).toEqual({ remoteId: `at://${DID}/app.bsky.feed.post/3jzfcijpj2z2a`, url: `https://bsky.app/profile/${DID}/post/3jzfcijpj2z2a` });
    expect(fake.records).toEqual([expect.objectContaining({ repo: DID, collection: 'app.bsky.feed.post', record: expect.objectContaining({ text: 'Hello from Postwerk' }) })]);
    // First try without the PDS nonce, then with it.
    expect(fake.log.filter((line) => line.endsWith('createRecord'))).toHaveLength(2);
  });

  it('refreshes only when the access token runs out', async () => {
    const credentials: BlueskyOAuth = { kind: 'oauth', ...(await signIn()) };
    expect(bluesky.needsRefresh!(credentials, Date.now())).toBe(false);
    expect(bluesky.needsRefresh!(credentials, credentials.expiresAt - 30_000)).toBe(true);
    expect(bluesky.needsRefresh!({ service: 'https://bsky.social', identifier: 'a', appPassword: 'b' }, Date.now())).toBe(false);
    const refreshed = await bluesky.refresh!(credentials, { keys: [fake.clientKey!] });
    expect(refreshed).toMatchObject({ kind: 'oauth', accessToken: 'at-2' });
  });

  it('explains unknown handles', async () => {
    await expect(startLogin(confidential(), 'nobody.test', 's')).rejects.toThrow('We could not find @nobody.test on Bluesky. Check the handle and try again.');
    await expect(startLogin(confidential(), 'not a handle', 's')).rejects.toThrow(/is not a Bluesky handle/);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('blocked', { status: 403 })));
    await expect(startLogin(confidential(), 'alice.test', 's')).rejects.toThrow('Bluesky could not be reached. Please try again in a moment.');
  });

  it('only talks to public https servers', async () => {
    await expect(resolveDid('did:web:localhost')).rejects.toThrow(/public https address/);
    fake.pdsOf[DID] = 'http://10.0.0.5';
    await expect(startLogin(confidential(), 'alice.test', 's')).rejects.toThrow(/public https address/);
  });

  it('publishes only the public half of its key', () => {
    const jwk = publicJwk(fake.clientKey!);
    expect(jwk).toMatchObject({ kty: 'EC', crv: 'P-256', kid: 'k1', use: 'sig', alg: 'ES256' });
    expect(jwk).not.toHaveProperty('d');
  });
});
