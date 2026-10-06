import { and, asc, eq } from 'drizzle-orm';
import { bridgeProfiles, socialAccounts, type Database, type oauthStates } from '@postwerk/db';
import {
  getBridge,
  getProviderInfo,
  isBridgeCredentials,
  ProviderError,
  ZERNIO_BASE_URL,
  type Bridge,
  type BridgeConfig,
  type BridgeCredentials,
  type ConnectedAccount,
  type PostContent,
  type ProviderId,
  type PublishContext,
  type PublishResult,
} from '@postwerk/providers';
import { createOAuthState, deleteAccount } from './accounts';
import { isProviderAvailable } from './clients';
import { decryptJson } from './crypto';

type Env = Record<string, string | undefined>;

/**
 * The bridge this server publishes through, if the admin set one up
 * (ZERNIO_API_KEY). It covers networks that would otherwise need a
 * developer app and its review.
 */
export function bridgeSetup(env: Env = process.env): { bridge: Bridge; config: BridgeConfig } | undefined {
  const apiKey = env.ZERNIO_API_KEY?.trim();
  if (!apiKey) return undefined;
  return { bridge: getBridge('zernio'), config: { apiKey, baseUrl: env.ZERNIO_BASE_URL?.trim() || ZERNIO_BASE_URL } };
}

/** Networks the admin listed in ZERNIO_NETWORKS (they go through the bridge even when a developer app exists), or undefined. */
function listedNetworks(env: Env): Set<string> | undefined {
  const list = env.ZERNIO_NETWORKS?.split(',').map((name) => name.trim()).filter(Boolean);
  return list?.length ? new Set(list) : undefined;
}

export type NetworkRoute = 'native' | 'bridge' | 'unavailable';

/**
 * How people connect a network on this server:
 * native (its own API: no setup needed, or the admin's developer app) →
 * bridge (the aggregator) → unavailable ("coming soon" until either is set up).
 * Networks listed in ZERNIO_NETWORKS use the bridge even when native works;
 * when the list is set, other networks never use it.
 */
export function networkRoute(id: ProviderId, env: Env = process.env): NetworkRoute {
  const setup = bridgeSetup(env);
  const bridgeable = Boolean(setup?.bridge.platforms[id]);
  const listed = listedNetworks(env);
  if (bridgeable && listed?.has(id)) return 'bridge';
  if (isProviderAvailable(id, env)) return 'native';
  if (bridgeable && !listed) return 'bridge';
  return 'unavailable';
}

/** The bridge that could connect a network once the admin sets it up (for setup notes): its name and the variable to set. */
export function bridgeFor(id: ProviderId): { name: string; env: string } | null {
  const bridge = getBridge('zernio');
  return bridge.platforms[id] ? { name: bridge.name, env: 'ZERNIO_API_KEY' } : null;
}

function requireSetup(env?: Env) {
  const setup = bridgeSetup(env);
  if (!setup) {
    throw new ProviderError('Connecting through Zernio is not set up on this server (ZERNIO_API_KEY).', {
      retryable: true,
      de: 'Die Verbindung über Zernio ist auf diesem Server nicht eingerichtet (ZERNIO_API_KEY).',
    });
  }
  return setup;
}

/**
 * A profile of the workspace that has no account of this network yet (a
 * profile holds one account per network); creates one when all are taken.
 */
async function freeProfile(db: Database, setup: { bridge: Bridge; config: BridgeConfig }, workspace: { id: string; name: string }, network: ProviderId): Promise<string> {
  const rows = await db
    .select()
    .from(bridgeProfiles)
    .where(and(eq(bridgeProfiles.workspaceId, workspace.id), eq(bridgeProfiles.bridge, setup.bridge.id)))
    .orderBy(asc(bridgeProfiles.createdAt));
  for (const row of rows) {
    if ((await setup.bridge.listAccounts(setup.config, row.profileId, network)).length === 0) return row.profileId;
  }
  const profileId = await setup.bridge.createProfile(setup.config, `${workspace.name} · Postwerk${rows.length > 0 ? ` ${rows.length + 1}` : ''}`);
  await db.insert(bridgeProfiles).values({ workspaceId: workspace.id, bridge: setup.bridge.id, profileId });
  return profileId;
}

/** The bridge credentials of one of the workspace's accounts. */
async function bridgedAccount(db: Database, workspaceId: string, accountId: string) {
  const account = await db.query.socialAccounts.findFirst({ where: and(eq(socialAccounts.id, accountId), eq(socialAccounts.workspaceId, workspaceId)) });
  if (!account?.bridge) return undefined;
  const credentials = decryptJson<unknown>(account.credentialsEnc);
  return isBridgeCredentials(credentials) ? { account, credentials } : undefined;
}

/**
 * Starts connecting a network through the bridge: returns the bridge's
 * sign-in page. `reconnect` refreshes one of the workspace's bridged accounts.
 */
export async function startBridgeConnect(
  db: Database,
  input: { workspace: { id: string; name: string }; userId: string; network: ProviderId; appUrl: string; reconnect?: string },
  env?: Env,
): Promise<string> {
  const setup = requireSetup(env);
  if (!setup.bridge.platforms[input.network]) throw new ProviderError(`${setup.bridge.name} cannot connect ${getProviderInfo(input.network).name}.`);
  let profileId: string;
  let reconnectAccountId: string | undefined;
  if (input.reconnect) {
    const existing = await bridgedAccount(db, input.workspace.id, input.reconnect);
    if (!existing || existing.account.provider !== input.network) throw new ProviderError('This account can no longer be reconnected. Connect it again.');
    ({ profileId, accountId: reconnectAccountId } = existing.credentials);
  } else {
    profileId = await freeProfile(db, setup, input.workspace, input.network);
  }
  const state = await createOAuthState(db, {
    workspaceId: input.workspace.id,
    userId: input.userId,
    provider: input.network,
    data: { bridge: setup.bridge.id, profileId },
  });
  // Our own state comes back on the redirect; the bridge adds the result to it.
  return setup.bridge.connectUrl(setup.config, {
    profileId,
    network: input.network,
    redirectUrl: `${input.appUrl.replace(/\/$/, '')}/api/bridge/callback?state=${state}`,
    reconnectAccountId,
  });
}

/**
 * Finishes connecting: the account is looked up on the bridge, in the
 * profile this sign-in started with, so a tampered redirect cannot attach
 * someone else's account.
 */
export async function finishBridgeConnect(
  state: Pick<typeof oauthStates.$inferSelect, 'provider' | 'data'>,
  params: { accountId: string | null; profileId: string | null },
  env?: Env,
): Promise<ConnectedAccount<BridgeCredentials>> {
  const setup = requireSetup(env);
  const profileId = state.data.profileId;
  if (!profileId || state.data.bridge !== setup.bridge.id || (params.profileId && params.profileId !== profileId)) {
    throw new ProviderError('This sign-in link has expired. Please try again.', { de: 'Dieser Anmelde-Link ist abgelaufen. Bitte versuch es noch einmal.' });
  }
  const accounts = await setup.bridge.listAccounts(setup.config, profileId, state.provider);
  const account = params.accountId ? accounts.find((candidate) => candidate.id === params.accountId) : accounts.length === 1 ? accounts[0] : undefined;
  if (!account) {
    throw new ProviderError(`${setup.bridge.name} did not report the connected account. Please try again.`, {
      de: `${setup.bridge.name} hat das verbundene Konto nicht gemeldet. Bitte versuch es noch einmal.`,
    });
  }
  return {
    profile: {
      // The network's own id stays the same when the account is connected again.
      externalId: `${setup.bridge.id}:${account.platformUserId ?? account.id}`,
      handle: account.username ? `@${account.username.replace(/^@/, '')}` : (account.displayName ?? account.id),
      displayName: account.displayName,
      avatarUrl: account.avatarUrl,
    },
    credentials: { via: setup.bridge.id, accountId: account.id, profileId },
  };
}

/**
 * Disconnects an account; bridged accounts are removed from the bridge
 * first, so it stops billing for them. Returns what was removed.
 */
export async function disconnectAccount(db: Database, workspaceId: string, accountId: string, env?: Env) {
  const bridged = await bridgedAccount(db, workspaceId, accountId).catch(() => undefined);
  const setup = bridgeSetup(env);
  if (bridged && setup && setup.bridge.id === bridged.credentials.via) await setup.bridge.disconnect(setup.config, bridged.credentials.accountId);
  return deleteAccount(db, workspaceId, accountId);
}

/** Publishes a bridged account's post through its bridge. */
export async function publishViaBridge(network: ProviderId, credentials: unknown, content: PostContent, context: PublishContext, env?: Env): Promise<PublishResult> {
  if (!isBridgeCredentials(credentials)) throw new ProviderError('Account needs to be reconnected.', { needsReauth: true });
  const setup = bridgeSetup(env);
  if (!setup || setup.bridge.id !== credentials.via) {
    throw new ProviderError('This account publishes through Zernio, which is not set up on this server anymore (ZERNIO_API_KEY).', { retryable: true });
  }
  return setup.bridge.publish(setup.config, network, credentials, content, context);
}
