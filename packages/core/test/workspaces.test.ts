import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, plugins, sessions, users, workspaces, type Database, type MemberRole } from '@postwerk/db';
import { runMigrations } from '../../db/src/migrate';
import {
  acceptInvite,
  changeMemberRole,
  createInvite,
  createWorkspace,
  findInvite,
  INVITE_TTL_MS,
  listInvites,
  listMembers,
  listUserWorkspaces,
  PermissionError,
  removeMember,
  renameWorkspace,
  revokeInvite,
  switchSessionWorkspace,
} from '../src/workspaces';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('workspaces, members and invites (Postgres)', () => {
  let db: Database;
  let owner: string;
  let workspaceId: string;

  beforeAll(async () => {
    await runMigrations(url);
    db = createDb(url);
  });

  afterAll(async () => db?.close());

  async function user(name: string) {
    const [row] = await db.insert(users).values({ email: `${name}@example.com`, name, passwordHash: 'x' }).returning();
    return row!.id;
  }

  /** Adds `name` to the workspace with `role` via an invite. */
  async function member(name: string, role: MemberRole) {
    const id = await user(name);
    const { token } = await createInvite(db, { workspaceId, actor: { userId: owner, role: 'owner' }, role });
    await acceptInvite(db, token, id);
    return id;
  }

  const roleOf = async (userId: string) => (await listMembers(db, workspaceId)).find((m) => m.userId === userId)?.role;

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE users, workspaces CASCADE`);
    owner = await user('owner');
    workspaceId = (await createWorkspace(db, owner, '  Studio  ')).id;
  });

  it('creates a workspace with its owner and the built-in themes', async () => {
    expect(await listUserWorkspaces(db, owner)).toMatchObject([{ id: workspaceId, name: 'Studio', role: 'owner' }]);
    expect(await db.select().from(plugins).where(eq(plugins.workspaceId, workspaceId))).toHaveLength(3);
    await expect(createWorkspace(db, owner, '   ')).rejects.toThrow(PermissionError);
  });

  it('lets owners and admins rename, not editors', async () => {
    const editor = await member('ed', 'editor');
    expect(await renameWorkspace(db, workspaceId, { userId: owner, role: 'owner' }, 'Agency')).toBe('Agency');
    await expect(renameWorkspace(db, workspaceId, { userId: editor, role: 'editor' }, 'Mine')).rejects.toThrow(/owners and admins/);
  });

  it('keeps at least one owner', async () => {
    await expect(changeMemberRole(db, workspaceId, { userId: owner, role: 'owner' }, owner, 'admin')).rejects.toThrow(/at least one owner/);
    await expect(removeMember(db, workspaceId, { userId: owner, role: 'owner' }, owner)).rejects.toThrow(/only owner/);
    const second = await member('second', 'admin');
    await changeMemberRole(db, workspaceId, { userId: owner, role: 'owner' }, second, 'owner');
    await changeMemberRole(db, workspaceId, { userId: owner, role: 'owner' }, owner, 'editor');
    expect(await roleOf(owner)).toBe('editor');
    expect(await roleOf(second)).toBe('owner');
  });

  it('never ends up without an owner, even when two owners demote each other at once', async () => {
    const second = await member('second', 'owner');
    const results = await Promise.allSettled([
      changeMemberRole(db, workspaceId, { userId: owner, role: 'owner' }, second, 'editor'),
      changeMemberRole(db, workspaceId, { userId: second, role: 'owner' }, owner, 'editor'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const owners = (await listMembers(db, workspaceId)).filter((m) => m.role === 'owner');
    expect(owners).toHaveLength(1);
  });

  it('stops admins from touching owners or handing out ownership', async () => {
    const admin = await member('admin', 'admin');
    const editor = await member('ed', 'editor');
    const asAdmin = { userId: admin, role: 'admin' as const };
    await changeMemberRole(db, workspaceId, asAdmin, editor, 'admin');
    expect(await roleOf(editor)).toBe('admin');
    await expect(changeMemberRole(db, workspaceId, asAdmin, editor, 'owner')).rejects.toThrow(/Only owners/);
    await expect(changeMemberRole(db, workspaceId, asAdmin, owner, 'editor')).rejects.toThrow(/Only owners/);
    await expect(removeMember(db, workspaceId, asAdmin, owner)).rejects.toThrow(/Only owners/);
    await expect(createInvite(db, { workspaceId, actor: asAdmin, role: 'owner' })).rejects.toThrow(/Only owners/);
    await removeMember(db, workspaceId, asAdmin, editor);
    expect(await roleOf(editor)).toBeUndefined();
  });

  it('lets editors leave but not manage anyone', async () => {
    const editor = await member('ed', 'editor');
    const other = await member('other', 'editor');
    const asEditor = { userId: editor, role: 'editor' as const };
    await expect(removeMember(db, workspaceId, asEditor, other)).rejects.toThrow(/owners and admins/);
    await expect(createInvite(db, { workspaceId, actor: asEditor, role: 'editor' })).rejects.toThrow(PermissionError);
    await removeMember(db, workspaceId, asEditor, editor);
    expect(await roleOf(editor)).toBeUndefined();
  });

  it('invites work once, list with their links and can be revoked', async () => {
    const asOwner = { userId: owner, role: 'owner' as const };
    const { id, token } = await createInvite(db, { workspaceId, actor: asOwner, email: ' Bob@Example.com ', role: 'admin' });
    expect(await listInvites(db, workspaceId)).toMatchObject([{ id, email: 'bob@example.com', role: 'admin', token }]);
    expect(await findInvite(db, token)).toMatchObject({ status: 'valid', role: 'admin', workspace: { id: workspaceId, name: 'Studio' }, inviter: 'owner' });

    const bob = await user('bob');
    expect(await acceptInvite(db, token, bob)).toEqual({ workspaceId, role: 'admin', joined: true });
    expect(await findInvite(db, token)).toMatchObject({ status: 'used' });
    expect(await listInvites(db, workspaceId)).toEqual([]);
    await expect(acceptInvite(db, token, await user('eve'))).rejects.toThrow(/expired or was already used/);

    const second = await createInvite(db, { workspaceId, actor: asOwner, role: 'editor' });
    expect(await revokeInvite(db, workspaceId, asOwner, second.id)).toEqual({ email: null });
    expect(await findInvite(db, second.token)).toBeUndefined();
    await expect(createInvite(db, { workspaceId, actor: asOwner, email: 'not-an-email', role: 'editor' })).rejects.toThrow(/valid email/);
  });

  it('refuses expired invites and leaves existing members as they are', async () => {
    const asOwner = { userId: owner, role: 'owner' as const };
    const past = new Date(Date.now() - INVITE_TTL_MS - 1000);
    const expired = await createInvite(db, { workspaceId, actor: asOwner, role: 'editor' }, past);
    expect(await findInvite(db, expired.token)).toMatchObject({ status: 'expired' });
    await expect(acceptInvite(db, expired.token, await user('late'))).rejects.toThrow(PermissionError);

    const again = await createInvite(db, { workspaceId, actor: asOwner, role: 'editor' });
    expect(await acceptInvite(db, again.token, owner)).toEqual({ workspaceId, role: 'owner', joined: false });
    expect(await findInvite(db, again.token)).toMatchObject({ status: 'valid' });
  });

  it('switches a session only to workspaces the user belongs to', async () => {
    const other = (await createWorkspace(db, owner, 'Second')).id;
    const [foreignOwner] = await db.insert(users).values({ email: 'x@example.com', name: 'X', passwordHash: 'x' }).returning();
    const foreign = (await createWorkspace(db, foreignOwner!.id, 'Foreign')).id;
    await db.insert(sessions).values({ id: 's1', userId: owner, expiresAt: new Date(Date.now() + 60_000) });
    expect(await switchSessionWorkspace(db, 's1', owner, other)).toBe(true);
    expect(await switchSessionWorkspace(db, 's1', owner, foreign)).toBe(false);
    const [session] = await db.select().from(sessions).where(eq(sessions.id, 's1'));
    expect(session!.workspaceId).toBe(other);
    // Deleting the workspace sends the session back to the default.
    await db.delete(workspaces).where(eq(workspaces.id, other));
    const [after] = await db.select().from(sessions).where(eq(sessions.id, 's1'));
    expect(after!.workspaceId).toBeNull();
  });
});
