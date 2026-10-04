import { and, eq, inArray, sql } from 'drizzle-orm';
import { mastodonApps, oauthStates, posts, postTargets, socialAccounts, type Database } from '@postwerk/db';
import { Mastodon, type AccountProfile, type ProviderId } from '@postwerk/providers';
import { decrypt, encrypt, encryptJson } from './crypto';
import { generateToken } from './password';

export async function saveAccount(
  db: Database,
  input: { workspaceId: string; provider: ProviderId; profile: AccountProfile; credentials: unknown; maxLength?: number },
) {
  const values = {
    workspaceId: input.workspaceId,
    provider: input.provider,
    externalId: input.profile.externalId,
    handle: input.profile.handle,
    displayName: input.profile.displayName ?? null,
    avatarUrl: input.profile.avatarUrl ?? null,
    credentialsEnc: encryptJson(input.credentials),
    maxLength: input.maxLength ?? null,
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

export async function deleteAccount(db: Database, workspaceId: string, accountId: string) {
  await db.transaction(async (tx) => {
    await tx.delete(socialAccounts).where(and(eq(socialAccounts.id, accountId), eq(socialAccounts.workspaceId, workspaceId)));
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
  });
}

/** Returns our OAuth client on a Mastodon server, registering it on first use. */
export async function getOrRegisterMastodonApp(db: Database, instanceUrl: string, redirectUri: string, appName: string, website?: string) {
  const existing = await db.query.mastodonApps.findFirst({
    where: and(eq(mastodonApps.instanceUrl, instanceUrl), eq(mastodonApps.redirectUri, redirectUri)),
  });
  if (existing) return { clientId: existing.clientId, clientSecret: decrypt(existing.clientSecretEnc) };

  const app = await Mastodon.registerApp(instanceUrl, redirectUri, appName, website);
  await db
    .insert(mastodonApps)
    .values({ instanceUrl, redirectUri, clientId: app.clientId, clientSecretEnc: encrypt(app.clientSecret) })
    .onConflictDoNothing();
  return app;
}

const STATE_TTL_MS = 10 * 60_000;

export async function createOAuthState(
  db: Database,
  input: { workspaceId: string; userId: string; provider: ProviderId; data: Record<string, string> },
): Promise<string> {
  const state = generateToken();
  await db.insert(oauthStates).values({ ...input, state, expiresAt: new Date(Date.now() + STATE_TTL_MS) });
  return state;
}

/** Single use: the state row is deleted whether or not it is still valid. */
export async function consumeOAuthState(db: Database, state: string, userId: string) {
  const [row] = await db.delete(oauthStates).where(eq(oauthStates.state, state)).returning();
  if (!row || row.userId !== userId || row.expiresAt < new Date()) return null;
  return row;
}
