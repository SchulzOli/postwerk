import { and, eq, inArray, sql } from 'drizzle-orm';
import { mastodonApps, oauthStates, posts, postTargets, socialAccounts, type Database } from '@postwerk/db';
import { Mastodon, type AccountProfile, type BridgeId, type ConnectedAccount, type ProviderId } from '@postwerk/providers';
import { decrypt, encrypt, encryptJson } from './crypto';
import { generateToken } from './password';

export async function saveAccount(
  db: Database,
  input: { workspaceId: string; provider: ProviderId; profile: AccountProfile; credentials: unknown; maxLength?: number; bridge?: BridgeId | null },
) {
  // A reconnect replaces credentials and clears "needs reconnect"; the account keeps its id and posts.
  const values = {
    workspaceId: input.workspaceId,
    provider: input.provider,
    externalId: input.profile.externalId,
    handle: input.profile.handle,
    displayName: input.profile.displayName ?? null,
    avatarUrl: input.profile.avatarUrl ?? null,
    credentialsEnc: encryptJson(input.credentials),
    maxLength: input.maxLength ?? null,
    // A native reconnect of a bridged account (or the other way round) switches how it publishes.
    bridge: input.bridge ?? null,
    status: 'active' as const,
    updatedAt: new Date(),
  };
  const [account] = await db
    .insert(socialAccounts)
    .values(values)
    .onConflictDoUpdate({
      target: [socialAccounts.workspaceId, socialAccounts.provider, socialAccounts.externalId],
      set: values,
    })
    .returning();
  return account!;
}

/** Disconnects an account; returns what was removed (undefined if nothing was). */
export async function deleteAccount(db: Database, workspaceId: string, accountId: string) {
  return db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(socialAccounts)
      .where(and(eq(socialAccounts.id, accountId), eq(socialAccounts.workspaceId, workspaceId)))
      .returning({ handle: socialAccounts.handle, provider: socialAccounts.provider });
    // Targets cascade away with the account; unpublished posts left without any target would never run.
    await tx
      .delete(posts)
      .where(
        and(
          eq(posts.workspaceId, workspaceId),
          inArray(posts.status, ['draft', 'scheduled']),
          sql`NOT EXISTS (SELECT 1 FROM ${postTargets} WHERE ${postTargets.postId} = ${posts.id})`,
        ),
      );
    return deleted;
  });
}

/** Returns our OAuth client on a Mastodon server, registering it on first use. */
export async function getOrRegisterMastodonApp(db: Database, instanceUrl: string, redirectUri: string, appName: string, website?: string) {
  const existing = await db.query.mastodonApps.findFirst({
    where: and(eq(mastodonApps.instanceUrl, instanceUrl), eq(mastodonApps.redirectUri, redirectUri)),
  });
  if (existing) {
    try {
      return { clientId: existing.clientId, clientSecret: decrypt(existing.clientSecretEnc) };
    } catch {
      // ENCRYPTION_KEY changed since the app was registered: register a fresh one below.
    }
  }

  const app = await Mastodon.registerApp(instanceUrl, redirectUri, appName, website);
  const values = { clientId: app.clientId, clientSecretEnc: encrypt(app.clientSecret) };
  await db
    .insert(mastodonApps)
    .values({ instanceUrl, redirectUri, ...values })
    .onConflictDoUpdate({ target: [mastodonApps.instanceUrl, mastodonApps.redirectUri], set: values });
  return app;
}

/** Saves every account a connect flow returned (one login can grant several pages/boards/locations). */
export async function saveConnectedAccounts(db: Database, workspaceId: string, provider: ProviderId, accounts: ConnectedAccount<unknown>[], bridge?: BridgeId) {
  const saved = [];
  for (const account of accounts) {
    saved.push(
      await saveAccount(db, { workspaceId, provider, profile: account.profile, credentials: account.credentials, maxLength: account.limits?.maxLength, bridge }),
    );
  }
  return saved;
}

const STATE_TTL_MS = 10 * 60_000;

export async function createOAuthState(
  db: Database,
  input: { workspaceId: string; userId: string; provider: ProviderId; data: Record<string, string>; state?: string },
): Promise<string> {
  // Bluesky sends the state to the server before the row exists, so it may come pre-made.
  const { state = generateToken(), ...rest } = input;
  await db.insert(oauthStates).values({ ...rest, state, expiresAt: new Date(Date.now() + STATE_TTL_MS) });
  return state;
}

/** Single use: the state row is deleted whether or not it is still valid. */
export async function consumeOAuthState(db: Database, state: string, userId: string) {
  const [row] = await db.delete(oauthStates).where(eq(oauthStates.state, state)).returning();
  if (!row || row.userId !== userId || row.expiresAt < new Date()) return null;
  return row;
}
