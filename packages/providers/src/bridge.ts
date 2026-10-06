/**
 * Bridges: aggregator APIs that publish to networks on Postwerk's behalf, so
 * people can use a network without the server admin registering a developer
 * app (and passing its review). The aggregator holds the network tokens;
 * Postwerk stores only which aggregator account a social account is.
 */
import type { PostContent, ProviderId, PublishContext, PublishResult } from './types';

export const BRIDGE_IDS = ['zernio'] as const;
export type BridgeId = (typeof BRIDGE_IDS)[number];

export const isBridgeId = (value: unknown): value is BridgeId => BRIDGE_IDS.includes(value as BridgeId);

/** Server settings of a bridge (from the environment). */
export interface BridgeConfig {
  apiKey: string;
  /** API base, e.g. https://zernio.com/api (tests point it at a fake). */
  baseUrl: string;
}

/** What Postwerk keeps for an account connected through a bridge (stored encrypted like any credentials). */
export interface BridgeCredentials {
  via: BridgeId;
  /** The bridge's id of the account. */
  accountId: string;
  /** The bridge's profile (group of accounts) it belongs to. */
  profileId: string;
}

export interface BridgeAccount {
  id: string;
  /** The bridge's platform name (e.g. "twitter"). */
  platform: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  /** The network's own id of the account, stable across reconnects. */
  platformUserId?: string;
  /** False when the network revoked access; the account has to be connected again. */
  active: boolean;
}

export interface Bridge {
  id: BridgeId;
  name: string;
  /** Postwerk networks the bridge can publish to, with the bridge's platform name for each. */
  platforms: Partial<Record<ProviderId, string>>;
  /** Creates a profile (a group of accounts; Postwerk uses them per workspace) and returns its id. */
  createProfile(config: BridgeConfig, name: string): Promise<string>;
  /** Where to send the browser to connect an account (the bridge's hosted sign-in and selection pages). */
  connectUrl(config: BridgeConfig, input: { profileId: string; network: ProviderId; redirectUrl: string; reconnectAccountId?: string }): Promise<string>;
  /** The accounts of a profile, optionally only one platform's. */
  listAccounts(config: BridgeConfig, profileId: string, network?: ProviderId): Promise<BridgeAccount[]>;
  /** Removes an account from the bridge (stops its billing). Missing accounts are fine. */
  disconnect(config: BridgeConfig, accountId: string): Promise<void>;
  publish(config: BridgeConfig, network: ProviderId, credentials: BridgeCredentials, content: PostContent, context: PublishContext): Promise<PublishResult>;
}

export function isBridgeCredentials(value: unknown): value is BridgeCredentials {
  const candidate = value as Partial<BridgeCredentials> | null;
  return Boolean(candidate && typeof candidate === 'object' && BRIDGE_IDS.includes(candidate.via as BridgeId) && typeof candidate.accountId === 'string');
}
