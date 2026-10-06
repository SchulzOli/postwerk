/**
 * AT Protocol OAuth (Bluesky): identity resolution, pushed authorization
 * requests, DPoP-bound tokens and confidential client authentication.
 * https://atproto.com/specs/oauth
 *
 * Postwerk is a confidential client when it runs on https (it signs token
 * requests with its own ES256 key, published as JWKS); during local
 * development on 127.0.0.1 it is a "loopback" public client.
 */
import { request, withQuery } from './http';
import { base64Url, codeChallenge, generateCodeVerifier } from './oauth';
import { ProviderError, type PrivateJwk } from './types';

/** Full access to the account's repository, like an app password. */
export const ATPROTO_SCOPE = 'atproto transition:generic';

/** How Postwerk identifies itself when a user signs in. */
export interface AtprotoClient {
  clientId: string;
  redirectUri: string;
  /** Confidential clients sign with the first key; loopback clients have none. */
  keys: PrivateJwk[];
}

/** Where identities are looked up. Tests point these at local fakes. */
export const atprotoNetwork = {
  plcDirectory: 'https://plc.directory',
  /** Resolves handles to DIDs; Bluesky's public AppView resolves any handle on the network. */
  appView: 'https://public.api.bsky.app',
  /** Allow http and private addresses (tests only). */
  allowInsecure: false,
};

// ---------------------------------------------------------------------------
// Keys and JWTs (WebCrypto)
// ---------------------------------------------------------------------------

const ES256 = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const encoder = new TextEncoder();
const encodeJson = (value: unknown) => base64Url(encoder.encode(JSON.stringify(value)));
const randomId = () => base64Url(crypto.getRandomValues(new Uint8Array(16)));
const seconds = () => Math.floor(Date.now() / 1000);

export async function generateSigningKey(kid?: string): Promise<PrivateJwk> {
  const pair = await crypto.subtle.generateKey(ES256, true, ['sign', 'verify']);
  const { kty, crv, x, y, d } = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { kty: kty!, crv: crv!, x: x!, y: y!, d, ...(kid && { kid }) };
}

/** The public half of a key, as published in the client's JWKS. */
export function publicJwk({ kty, crv, x, y, kid }: PrivateJwk) {
  return { kty, crv, x, y, ...(kid && { kid }), use: 'sig', alg: 'ES256' };
}

export async function signJwt(key: PrivateJwk, header: Record<string, unknown>, payload: Record<string, unknown>): Promise<string> {
  const { kty, crv, x, y, d } = key;
  const signer = await crypto.subtle.importKey('jwk', { kty, crv, x, y, d }, ES256, false, ['sign']);
  const input = `${encodeJson({ alg: 'ES256', ...header })}.${encodeJson(payload)}`;
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signer, encoder.encode(input));
  return `${input}.${base64Url(new Uint8Array(signature))}`;
}

async function sha256(text: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))));
}

// ---------------------------------------------------------------------------
// Fetching other people's servers
// ---------------------------------------------------------------------------

/** Addresses users could point us at to reach the server's own network. */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || /\.(localhost|local|internal)$/.test(host)) return true;
  // atproto services use host names; IP literals are not expected.
  if (host.includes(':')) return true;
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168);
}

function checkUrl(input: unknown, what: string): URL {
  let url: URL;
  try {
    url = new URL(String(input));
  } catch {
    throw new ProviderError(`${what} has an invalid address.`);
  }
  if (url.username || url.password) throw new ProviderError(`${what} has an invalid address.`);
  if (!atprotoNetwork.allowInsecure && (url.protocol !== 'https:' || isPrivateHost(url.hostname))) {
    throw new ProviderError(`${what} must be a public https address.`);
  }
  return url;
}

async function getJson<T>(url: string, what: string): Promise<T> {
  checkUrl(url, what);
  const response = await request(url, { headers: { accept: 'application/json' }, redirect: 'manual', timeoutMs: 15_000 });
  if (response.status !== 200) throw new ProviderError(`${what} could not be read (${response.status}).`, { retryable: true });
  try {
    return (await response.json()) as T;
  } catch {
    throw new ProviderError(`${what} could not be read.`, { retryable: true });
  }
}

// ---------------------------------------------------------------------------
// Identity: handle → DID → DID document → PDS
// ---------------------------------------------------------------------------

const HANDLE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;
const DID_PLC = /^did:plc:[a-z2-7]{24}$/;
const DID_WEB = /^did:web:[a-z0-9.-]+$/;

interface DidDocument {
  id: string;
  alsoKnownAs?: string[];
  service?: { id: string; type: string; serviceEndpoint: unknown }[];
}

export async function resolveHandle(handle: string): Promise<string> {
  if (!HANDLE.test(handle)) throw new ProviderError(`"${handle}" is not a Bluesky handle. It looks like you.bsky.social.`);
  try {
    const { did } = await getJson<{ did?: string }>(withQuery(`${atprotoNetwork.appView}/xrpc/com.atproto.identity.resolveHandle`, { handle }), 'Bluesky');
    if (typeof did === 'string' && (DID_PLC.test(did) || DID_WEB.test(did))) return did;
  } catch (error) {
    // 400 means "unknown handle"; anything else is Bluesky being unreachable.
    if (!(error instanceof ProviderError && error.status === 400)) {
      throw new ProviderError('Bluesky could not be reached. Please try again in a moment.', { retryable: true, cause: error });
    }
  }
  throw new ProviderError(`We could not find @${handle} on Bluesky. Check the handle and try again.`);
}

export async function resolveDid(did: string): Promise<DidDocument> {
  const url = DID_PLC.test(did)
    ? `${atprotoNetwork.plcDirectory}/${did}`
    : DID_WEB.test(did)
      ? `https://${did.slice('did:web:'.length)}/.well-known/did.json`
      : undefined;
  if (!url) throw new ProviderError('This account uses an identity type Postwerk does not support.');
  const doc = await getJson<DidDocument>(url, 'The account’s identity');
  if (doc?.id !== did) throw new ProviderError('The account’s identity document does not match the account.');
  return doc;
}

/** The account's data server (PDS), as an origin. */
export function pdsOf(doc: DidDocument): string {
  const service = doc.service?.find((entry) => (entry.id === '#atproto_pds' || entry.id === `${doc.id}#atproto_pds`) && entry.type === 'AtprotoPersonalDataServer');
  if (!service) throw new ProviderError('The account has no data server (PDS) in its identity document.');
  return checkUrl(service.serviceEndpoint, 'The account’s data server').origin;
}

export function handleOf(doc: DidDocument): string | undefined {
  return doc.alsoKnownAs?.find((alias) => alias.startsWith('at://'))?.slice('at://'.length);
}

// ---------------------------------------------------------------------------
// Authorization server discovery
// ---------------------------------------------------------------------------

export interface AuthServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  pushed_authorization_request_endpoint?: string;
  dpop_signing_alg_values_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  authorization_response_iss_parameter_supported?: boolean;
  client_id_metadata_document_supported?: boolean;
  protected_resources?: string[];
}

export async function authServerMetadata(issuer: string): Promise<AuthServerMetadata> {
  if (checkUrl(issuer, 'The sign-in server').origin !== issuer) throw new ProviderError('The sign-in server has an invalid address.');
  const metadata = await getJson<AuthServerMetadata>(`${issuer}/.well-known/oauth-authorization-server`, 'The sign-in server');
  // Mix-up protection: the server must call itself what we asked for.
  if (metadata.issuer !== issuer) throw new ProviderError('The sign-in server does not identify itself correctly.');
  if (metadata.client_id_metadata_document_supported !== true || !metadata.pushed_authorization_request_endpoint || !metadata.dpop_signing_alg_values_supported?.includes('ES256')) {
    throw new ProviderError('This server does not support signing in with Bluesky yet. Use an app password instead.');
  }
  for (const endpoint of [metadata.authorization_endpoint, metadata.token_endpoint, metadata.pushed_authorization_request_endpoint]) checkUrl(endpoint, 'The sign-in server');
  return metadata;
}

/** The authorization server that protects a data server (PDS). */
export async function authServerForPds(pds: string): Promise<AuthServerMetadata> {
  let resource: { resource?: string; authorization_servers?: string[] };
  try {
    resource = await getJson(`${pds}/.well-known/oauth-protected-resource`, 'The account’s data server');
  } catch (error) {
    // No resource metadata: the PDS is its own authorization server.
    if (error instanceof ProviderError && error.status === 404) return authServerMetadata(pds);
    throw error;
  }
  if (resource.resource !== pds) throw new ProviderError('The account’s data server does not identify itself correctly.');
  if (resource.authorization_servers?.length !== 1) throw new ProviderError('The account’s data server names no single sign-in server.');
  const metadata = await authServerMetadata(resource.authorization_servers[0]!);
  if (metadata.protected_resources && !metadata.protected_resources.includes(pds)) throw new ProviderError('The sign-in server does not protect the account’s data server.');
  return metadata;
}

/** What someone typed to sign in: a handle, a DID, or the address of their server. */
async function resolveLogin(input: string): Promise<{ metadata: AuthServerMetadata; hint?: string }> {
  const value = input.trim();
  if (/^https?:\/\//i.test(value)) {
    const origin = checkUrl(value, 'The server').origin;
    try {
      return { metadata: await authServerForPds(origin) };
    } catch (error) {
      // An entryway (like bsky.social) is an authorization server itself.
      return { metadata: await authServerMetadata(origin).catch(() => Promise.reject(error)) };
    }
  }
  const handleOrDid = value.replace(/^@/, '').toLowerCase();
  if (!handleOrDid) throw new ProviderError('Please enter your Bluesky handle.');
  const did = handleOrDid.startsWith('did:') ? handleOrDid : await resolveHandle(handleOrDid);
  const doc = await resolveDid(did);
  const handle = handleOf(doc);
  return { metadata: await authServerForPds(pdsOf(doc)), hint: handle === handleOrDid ? handle : did };
}

/** Re-checks that a DID really belongs to the sign-in server that vouched for it. */
async function verifyIssuer(did: string, issuer: string): Promise<{ pds: string; handle?: string }> {
  if (!DID_PLC.test(did) && !DID_WEB.test(did)) throw new ProviderError('The sign-in server returned an invalid account.');
  const doc = await resolveDid(did);
  const pds = pdsOf(doc);
  const metadata = await authServerForPds(pds);
  if (metadata.issuer !== issuer) throw new ProviderError('This account is not managed by the server that signed it in. Please try again.', { needsReauth: true });
  return { pds, handle: handleOf(doc) };
}

// ---------------------------------------------------------------------------
// DPoP (RFC 9449)
// ---------------------------------------------------------------------------

/** A DPoP key with the latest nonce a server gave us. */
export interface DpopState {
  key: PrivateJwk;
  nonce?: string;
}

function dpopProof(state: DpopState, method: string, url: string, ath?: string): Promise<string> {
  const { kty, crv, x, y } = state.key;
  // htu is the URL without query and fragment.
  const htu = url.split(/[?#]/)[0];
  return signJwt(state.key, { typ: 'dpop+jwt', jwk: { kty, crv, x, y } }, { jti: randomId(), htm: method, htu, iat: seconds(), nonce: state.nonce, ath });
}

async function isNonceError(response: Response, authServer: boolean): Promise<boolean> {
  if (response.status === 401) return /error="use_dpop_nonce"/.test(response.headers.get('www-authenticate') ?? '');
  if (response.status !== 400 || !authServer) return false;
  const body = (await response.clone().json().catch(() => undefined)) as { error?: string } | undefined;
  return body?.error === 'use_dpop_nonce';
}

/**
 * A request with a DPoP proof (and a DPoP-bound access token, for the PDS).
 * Servers hand out nonces; a request rejected for a missing or old nonce is
 * sent once more with the new one.
 */
export async function dpopFetch(state: DpopState, url: string, init: RequestInit & { method: string }, accessToken?: string): Promise<Response> {
  const ath = accessToken ? await sha256(accessToken) : undefined;
  const send = async () => {
    const headers = new Headers(init.headers);
    headers.set('dpop', await dpopProof(state, init.method, url, ath));
    if (accessToken) headers.set('authorization', `DPoP ${accessToken}`);
    let response: Response;
    try {
      response = await fetch(url, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(60_000) });
    } catch (error) {
      throw new ProviderError(`Request to ${new URL(url).host} failed: ${(error as Error).message}`, { retryable: true, cause: error });
    }
    const nonce = response.headers.get('dpop-nonce');
    const fresh = Boolean(nonce && nonce !== state.nonce);
    if (nonce) state.nonce = nonce;
    return { response, fresh };
  };
  const first = await send();
  if (!first.fresh || !(await isNonceError(first.response, !accessToken))) return first.response;
  await first.response.body?.cancel();
  return (await send()).response;
}

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  sub?: string;
  error?: string;
  error_description?: string;
}

/** The parts of an unfinished sign-in that the callback needs (kept server-side, encrypted). */
export interface PendingLogin {
  issuer: string;
  clientId: string;
  redirectUri: string;
  /** The client key used, so the callback signs with the same one. */
  kid?: string;
  codeVerifier: string;
  dpop: DpopState;
}

/** A signed-in AT Protocol session (credentials of an OAuth Bluesky account). */
export interface AtprotoSession {
  did: string;
  /** Data server (PDS) origin. */
  pds: string;
  issuer: string;
  clientId: string;
  /** Client key the session was created with; refreshes must use the same one. */
  kid?: string;
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  scope: string;
  dpopKey: PrivateJwk;
  /** Last handle the identity document listed. */
  handle?: string;
}

function signingKey(keys: PrivateJwk[], kid: string | undefined): PrivateJwk | undefined {
  if (kid === undefined) return undefined;
  const key = keys.find((candidate) => candidate.kid === kid);
  if (!key) throw new ProviderError('This server’s Bluesky sign-in key has changed. Please reconnect the account.', { needsReauth: true });
  return key;
}

/** A POST to the authorization server, authenticated as our client, with DPoP. */
async function authRequest(
  metadata: AuthServerMetadata,
  endpoint: string,
  client: { clientId: string; key?: PrivateJwk },
  dpop: DpopState,
  params: Record<string, string | undefined>,
): Promise<TokenResponse & { request_uri?: string }> {
  const body = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) if (value !== undefined) body.set(name, value);
  body.set('client_id', client.clientId);
  if (client.key) {
    if (!metadata.token_endpoint_auth_methods_supported?.includes('private_key_jwt')) throw new ProviderError('The sign-in server does not accept signed clients.');
    const now = seconds();
    body.set('client_assertion_type', 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
    body.set(
      'client_assertion',
      await signJwt(client.key, { kid: client.key.kid }, { iss: client.clientId, sub: client.clientId, aud: metadata.issuer, jti: randomId(), iat: now, exp: now + 60 }),
    );
  }
  const response = await dpopFetch(dpop, endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
    redirect: 'manual',
  });
  const json = (await response.json().catch(() => ({}))) as TokenResponse & { request_uri?: string };
  if (!response.ok) {
    const reason = json.error_description ?? json.error ?? `status ${response.status}`;
    throw new ProviderError(`Bluesky sign-in failed: ${reason}`, {
      status: response.status,
      needsReauth: json.error === 'invalid_grant' || response.status === 401,
      retryable: response.status === 429 || response.status >= 500,
    });
  }
  return json;
}

/** Starts a sign-in: finds the user's server and registers the request there (PAR). */
export async function startLogin(client: AtprotoClient, input: string, state: string): Promise<{ url: string; pending: PendingLogin }> {
  const { metadata, hint } = await resolveLogin(input);
  const key = client.keys[0];
  const codeVerifier = generateCodeVerifier();
  const dpop: DpopState = { key: await generateSigningKey() };
  const par = await authRequest(metadata, metadata.pushed_authorization_request_endpoint!, { clientId: client.clientId, key }, dpop, {
    response_type: 'code',
    redirect_uri: client.redirectUri,
    scope: ATPROTO_SCOPE,
    state,
    code_challenge: await codeChallenge(codeVerifier),
    code_challenge_method: 'S256',
    login_hint: hint,
  });
  if (typeof par.request_uri !== 'string') throw new ProviderError('The sign-in server gave an unexpected answer. Please try again.');
  return {
    url: withQuery(metadata.authorization_endpoint, { client_id: client.clientId, request_uri: par.request_uri }),
    pending: { issuer: metadata.issuer, clientId: client.clientId, redirectUri: client.redirectUri, kid: key?.kid, codeVerifier, dpop },
  };
}

function checkTokens(tokens: TokenResponse, now: number): Pick<AtprotoSession, 'accessToken' | 'refreshToken' | 'expiresAt' | 'scope'> & { sub: string } {
  if (
    typeof tokens.access_token !== 'string' ||
    typeof tokens.refresh_token !== 'string' ||
    tokens.token_type?.toLowerCase() !== 'dpop' ||
    typeof tokens.sub !== 'string' ||
    !tokens.scope?.split(' ').includes('atproto')
  ) {
    throw new ProviderError('The sign-in server gave an unexpected answer. Please try again.');
  }
  return {
    sub: tokens.sub,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    // Without an expiry, refresh after a few minutes to be safe.
    expiresAt: now + (typeof tokens.expires_in === 'number' ? tokens.expires_in : 300) * 1000,
    scope: tokens.scope,
  };
}

/** Finishes a sign-in with the code from the callback. */
export async function finishLogin(keys: PrivateJwk[], pending: PendingLogin, params: { code: string; iss: string | null }): Promise<AtprotoSession> {
  const metadata = await authServerMetadata(pending.issuer);
  if (params.iss === null ? metadata.authorization_response_iss_parameter_supported : params.iss !== metadata.issuer) {
    throw new ProviderError('The sign-in came back from a different server. Please try again.');
  }
  const now = Date.now();
  const tokens = checkTokens(
    await authRequest(metadata, metadata.token_endpoint, { clientId: pending.clientId, key: signingKey(keys, pending.kid) }, pending.dpop, {
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: pending.redirectUri,
      code_verifier: pending.codeVerifier,
    }),
    now,
  );
  // Only now can the account (sub) be trusted.
  const { pds, handle } = await verifyIssuer(tokens.sub, metadata.issuer);
  const { sub, ...rest } = tokens;
  return { did: sub, pds, handle, issuer: metadata.issuer, clientId: pending.clientId, kid: pending.kid, dpopKey: pending.dpop.key, ...rest };
}

/** New tokens for a session (refresh tokens are single-use). */
export async function refreshSession(session: AtprotoSession, keys: PrivateJwk[]): Promise<AtprotoSession> {
  const { pds, handle } = await verifyIssuer(session.did, session.issuer);
  const metadata = await authServerMetadata(session.issuer);
  const now = Date.now();
  const tokens = checkTokens(
    await authRequest(metadata, metadata.token_endpoint, { clientId: session.clientId, key: signingKey(keys, session.kid) }, { key: session.dpopKey }, {
      grant_type: 'refresh_token',
      refresh_token: session.refreshToken,
    }),
    now,
  );
  if (tokens.sub !== session.did) throw new ProviderError('The sign-in server returned a different account. Please reconnect it.', { needsReauth: true });
  const { sub, ...rest } = tokens;
  return { ...session, ...rest, pds, handle: handle ?? session.handle };
}

/** A session manager for @atproto/api's Agent: every request goes to the PDS with the DPoP-bound token. */
export function sessionFetcher(session: AtprotoSession) {
  const dpop: DpopState = { key: session.dpopKey };
  return {
    did: session.did,
    fetchHandler(path: string, init: RequestInit): Promise<Response> {
      // DPoP proofs name the method exactly as sent; fetch upper-cases it.
      return dpopFetch(dpop, new URL(path, session.pds).toString(), { ...init, method: (init.method ?? 'GET').toUpperCase() }, session.accessToken);
    },
  };
}
