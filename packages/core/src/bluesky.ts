import { eq } from 'drizzle-orm';
import { serverSecrets, type Database } from '@postwerk/db';
import { Atproto, Bluesky, ProviderError, type AtprotoKeyset, type PrivateJwk } from '@postwerk/providers';
import { createOAuthState } from './accounts';
import { decryptJson, encryptJson } from './crypto';
import { generateToken } from './password';

/**
 * Bluesky OAuth needs no developer app: Postwerk describes itself in a client
 * metadata document at its own address. On https it is a confidential client
 * with its own signing key; on localhost/127.0.0.1 it is a "loopback" client
 * for development. Anywhere else, people connect with app passwords.
 */
export const BLUESKY_METADATA_PATH = '/oauth/bluesky/client-metadata.json';
export const BLUESKY_JWKS_PATH = '/oauth/bluesky/jwks.json';
const CALLBACK_PATH = '/api/connect/bluesky/callback';
const KEY_NAME = 'bluesky-oauth-key';
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

const base = (appUrl: string) => appUrl.replace(/\/$/, '');

/** The client id and callback for an app address, or undefined when Bluesky OAuth cannot work there. */
export function blueskyClientIds(appUrl: string): { clientId: string; redirectUri: string; confidential: boolean } | undefined {
  let url: URL;
  try {
    url = new URL(appUrl);
  } catch {
    return undefined;
  }
  if (url.protocol === 'https:') {
    return { clientId: `${base(appUrl)}${BLUESKY_METADATA_PATH}`, redirectUri: `${base(appUrl)}${CALLBACK_PATH}`, confidential: true };
  }
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname)) {
    // Loopback clients must come back to an IP address, not "localhost" (RFC 8252).
    const redirect = new URL(`${base(appUrl)}${CALLBACK_PATH}`);
    if (redirect.hostname === 'localhost') redirect.hostname = '127.0.0.1';
    const redirectUri = redirect.toString();
    return { clientId: `http://localhost?${new URLSearchParams({ redirect_uri: redirectUri, scope: Atproto.ATPROTO_SCOPE })}`, redirectUri, confidential: false };
  }
  return undefined;
}

export const isBlueskyOAuthAvailable = (appUrl: string) => blueskyClientIds(appUrl) !== undefined;

/** Postwerk's signing key for Bluesky OAuth: created on first use, stored encrypted. */
export async function blueskyKeyset(db: Database): Promise<AtprotoKeyset> {
  const row = await db.query.serverSecrets.findFirst({ where: eq(serverSecrets.name, KEY_NAME) });
  if (row) {
    try {
      return { keys: [decryptJson<PrivateJwk>(row.valueEnc)] };
    } catch {
      // ENCRYPTION_KEY changed: the old key is unreadable, so start over (accounts must reconnect).
    }
  }
  const valueEnc = encryptJson(await Atproto.generateSigningKey(generateToken(8)));
  if (row) await db.update(serverSecrets).set({ valueEnc }).where(eq(serverSecrets.name, KEY_NAME));
  // Another process may have created one meanwhile: theirs wins, so everyone uses the same key.
  else await db.insert(serverSecrets).values({ name: KEY_NAME, valueEnc }).onConflictDoNothing();
  const stored = await db.query.serverSecrets.findFirst({ where: eq(serverSecrets.name, KEY_NAME) });
  return { keys: [decryptJson<PrivateJwk>(stored!.valueEnc)] };
}

/** The client metadata document Bluesky servers read (its URL is the client id). */
export function blueskyClientMetadata(appUrl: string) {
  const ids = blueskyClientIds(appUrl);
  if (!ids?.confidential) return undefined;
  return {
    client_id: ids.clientId,
    client_name: 'Postwerk',
    client_uri: base(appUrl),
    application_type: 'web',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    redirect_uris: [ids.redirectUri],
    scope: Atproto.ATPROTO_SCOPE,
    token_endpoint_auth_method: 'private_key_jwt',
    token_endpoint_auth_signing_alg: 'ES256',
    jwks_uri: `${base(appUrl)}${BLUESKY_JWKS_PATH}`,
    dpop_bound_access_tokens: true,
  };
}

/** The public keys token requests are signed with. */
export async function blueskyJwks(db: Database) {
  return { keys: (await blueskyKeyset(db)).keys.map(Atproto.publicJwk) };
}

/** Starts connecting a Bluesky account; returns the sign-in page on the user's server. */
export async function startBlueskyLogin(db: Database, input: { workspaceId: string; userId: string; handle: string; appUrl: string }): Promise<string> {
  const ids = blueskyClientIds(input.appUrl);
  if (!ids) throw new ProviderError('Signing in with Bluesky needs Postwerk on an https address. Use an app password instead.');
  const client = { clientId: ids.clientId, redirectUri: ids.redirectUri, keys: ids.confidential ? (await blueskyKeyset(db)).keys : [] };
  const state = generateToken();
  const { url, pending } = await Atproto.startLogin(client, input.handle, state);
  // The DPoP key and PKCE verifier must not leak: keep them encrypted until the callback.
  await createOAuthState(db, { workspaceId: input.workspaceId, userId: input.userId, provider: 'bluesky', state, data: { pending: encryptJson(pending) } });
  return url;
}

/** Finishes connecting with the callback's code; `data` is the consumed OAuth state's. */
export async function finishBlueskyLogin(db: Database, data: Record<string, string>, params: { code: string; iss: string | null }) {
  let pending: Atproto.PendingLogin;
  try {
    pending = decryptJson(data.pending ?? '');
  } catch {
    throw new ProviderError('This sign-in link has expired. Please try again.');
  }
  return Bluesky.connectOAuth(pending.kid ? await blueskyKeyset(db) : undefined, pending, params);
}
