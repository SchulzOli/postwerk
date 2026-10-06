import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import { invites, sessions, users, workspaceMembers, workspaces, type Database, type MemberRole, type Transaction as Tx } from '@postwerk/db';
import { decrypt, encrypt } from './crypto';
import { generateToken, hashToken } from './password';
import { installBuiltinPlugins } from './plugins';

/** A rule was broken (e.g. removing the last owner); the message is meant for the user. */
export class PermissionError extends Error {}

export const roles: MemberRole[] = ['owner', 'admin', 'editor'];
export const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;

/** Who is acting, in which role. */
export interface Actor {
  userId: string;
  role: MemberRole;
}

export const canManageWorkspace = (role: MemberRole) => role === 'owner' || role === 'admin';

/** Owners may do anything; admins may handle everyone except owners. */
function assertCanManage(actor: Actor, targetRole: MemberRole, newRole?: MemberRole) {
  if (!canManageWorkspace(actor.role)) throw new PermissionError('Only workspace owners and admins can manage members.');
  if ((targetRole === 'owner' || newRole === 'owner') && actor.role !== 'owner') throw new PermissionError('Only owners can change owners.');
}

function workspaceName(name: string): string {
  const trimmed = name.trim().slice(0, 80);
  if (!trimmed) throw new PermissionError('Please give the workspace a name.');
  return trimmed;
}

/** Creates a workspace owned by `userId`, with the built-in plugins installed. */
export async function createWorkspace(db: Database | Tx, userId: string, name: string) {
  const run = async (tx: Tx) => {
    const [workspace] = await tx.insert(workspaces).values({ name: workspaceName(name) }).returning();
    await tx.insert(workspaceMembers).values({ workspaceId: workspace!.id, userId, role: 'owner' });
    await installBuiltinPlugins(tx, workspace!.id);
    return workspace!;
  };
  // Inside a transaction this becomes a savepoint.
  return db.transaction(run);
}

export async function renameWorkspace(db: Database, workspaceId: string, actor: Actor, name: string): Promise<string> {
  if (!canManageWorkspace(actor.role)) throw new PermissionError('Only workspace owners and admins can rename the workspace.');
  const next = workspaceName(name);
  await db.update(workspaces).set({ name: next }).where(eq(workspaces.id, workspaceId));
  return next;
}

/** The user's workspaces, oldest membership first. */
export async function listUserWorkspaces(db: Database, userId: string) {
  const rows = await db.query.workspaceMembers.findMany({
    where: eq(workspaceMembers.userId, userId),
    orderBy: [asc(workspaceMembers.createdAt)],
    with: { workspace: true },
  });
  return rows.map((row) => ({ id: row.workspace.id, name: row.workspace.name, role: row.role, theme: row.theme }));
}

export async function listMembers(db: Database, workspaceId: string) {
  return db
    .select({ userId: users.id, name: users.name, email: users.email, role: workspaceMembers.role, joinedAt: workspaceMembers.createdAt })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(workspaceMembers.createdAt));
}

/** Locks the workspace's member rows and returns them, so owner counts cannot race. */
async function lockMembers(tx: Tx, workspaceId: string) {
  return tx.select().from(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId)).for('update');
}

export async function changeMemberRole(db: Database, workspaceId: string, actor: Actor, targetUserId: string, role: MemberRole) {
  if (!roles.includes(role)) throw new PermissionError('Unknown role.');
  return db.transaction(async (tx) => {
    const members = await lockMembers(tx, workspaceId);
    const target = members.find((member) => member.userId === targetUserId);
    if (!target) throw new PermissionError('This person is not a member of the workspace.');
    assertCanManage(actor, target.role, role);
    if (target.role === 'owner' && role !== 'owner' && members.filter((member) => member.role === 'owner').length === 1) {
      throw new PermissionError('A workspace needs at least one owner. Make someone else owner first.');
    }
    await tx
      .update(workspaceMembers)
      .set({ role })
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetUserId)));
    return { previous: target.role };
  });
}

/** Removes a member; `actor.userId === targetUserId` means leaving. */
export async function removeMember(db: Database, workspaceId: string, actor: Actor, targetUserId: string) {
  await db.transaction(async (tx) => {
    const members = await lockMembers(tx, workspaceId);
    const target = members.find((member) => member.userId === targetUserId);
    if (!target) throw new PermissionError('This person is not a member of the workspace.');
    if (actor.userId !== targetUserId) assertCanManage(actor, target.role);
    if (target.role === 'owner' && members.filter((member) => member.role === 'owner').length === 1) {
      throw new PermissionError(
        actor.userId === targetUserId ? 'You are the only owner. Make someone else owner before you leave.' : 'A workspace needs at least one owner.',
      );
    }
    await tx.delete(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetUserId)));
  });
}

// ---------------------------------------------------------------- invites

export async function createInvite(
  db: Database,
  input: { workspaceId: string; actor: Actor; email?: string; role: MemberRole },
  now = new Date(),
): Promise<{ id: string; token: string }> {
  if (!roles.includes(input.role)) throw new PermissionError('Unknown role.');
  assertCanManage(input.actor, 'editor', input.role);
  const email = input.email?.trim().toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PermissionError('Please enter a valid email address, or leave it empty for a link.');
  const token = generateToken();
  const [invite] = await db
    .insert(invites)
    .values({
      workspaceId: input.workspaceId,
      email,
      role: input.role,
      tokenHash: hashToken(token),
      tokenEnc: encrypt(token),
      invitedBy: input.actor.userId,
      expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
    })
    .returning({ id: invites.id });
  return { id: invite!.id, token };
}

/** Pending invites (not used, not expired), with their tokens so links can be copied again. */
export async function listInvites(db: Database, workspaceId: string, now = new Date()) {
  const rows = await db.query.invites.findMany({
    where: and(eq(invites.workspaceId, workspaceId), isNull(invites.acceptedAt), gt(invites.expiresAt, now)),
    orderBy: [asc(invites.createdAt)],
  });
  return rows.flatMap((row) => {
    try {
      return [{ id: row.id, email: row.email, role: row.role, expiresAt: row.expiresAt, token: decrypt(row.tokenEnc) }];
    } catch {
      return []; // ENCRYPTION_KEY changed; the link is unusable anyway.
    }
  });
}

export async function revokeInvite(db: Database, workspaceId: string, actor: Actor, inviteId: string) {
  if (!canManageWorkspace(actor.role)) throw new PermissionError('Only workspace owners and admins can revoke invites.');
  const [deleted] = await db
    .delete(invites)
    .where(and(eq(invites.id, inviteId), eq(invites.workspaceId, workspaceId), isNull(invites.acceptedAt)))
    .returning({ email: invites.email });
  return deleted;
}

export type InviteStatus = 'valid' | 'expired' | 'used';

/** Looks up an invite link for the "join" page. */
export async function findInvite(db: Database, token: string, now = new Date()) {
  const invite = await db.query.invites.findFirst({
    where: eq(invites.tokenHash, hashToken(token)),
    with: { workspace: true, inviter: { columns: { name: true } } },
  });
  if (!invite) return undefined;
  const status: InviteStatus = invite.acceptedAt ? 'used' : invite.expiresAt <= now ? 'expired' : 'valid';
  return { id: invite.id, status, email: invite.email, role: invite.role, workspace: { id: invite.workspace.id, name: invite.workspace.name }, inviter: invite.inviter?.name ?? null };
}

/**
 * Joins the user to the invite's workspace (single use). Someone who is
 * already a member keeps their role, and the invite stays unused.
 */
export async function acceptInvite(db: Database, token: string, userId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const [invite] = await tx.select().from(invites).where(eq(invites.tokenHash, hashToken(token))).for('update');
    if (!invite || invite.acceptedAt || invite.expiresAt <= now) {
      throw new PermissionError('This invite link has expired or was already used. Ask for a new one.');
    }
    const existing = await tx.query.workspaceMembers.findFirst({
      where: and(eq(workspaceMembers.workspaceId, invite.workspaceId), eq(workspaceMembers.userId, userId)),
    });
    if (existing) return { workspaceId: invite.workspaceId, role: existing.role, joined: false };
    await tx.insert(workspaceMembers).values({ workspaceId: invite.workspaceId, userId, role: invite.role });
    await tx.update(invites).set({ acceptedAt: now, acceptedBy: userId }).where(eq(invites.id, invite.id));
    return { workspaceId: invite.workspaceId, role: invite.role, joined: true };
  });
}

/** Points a session at one of the user's workspaces. */
export async function switchSessionWorkspace(db: Database, sessionId: string, userId: string, workspaceId: string): Promise<boolean> {
  const member = await db.query.workspaceMembers.findFirst({
    where: and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
  });
  if (!member) return false;
  await db.update(sessions).set({ workspaceId }).where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
  return true;
}
