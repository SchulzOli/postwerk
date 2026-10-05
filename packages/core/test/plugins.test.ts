import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, plugins, users, workspaceMembers, workspaces, type Database } from '@postwerk/db';
import { runMigrations } from '../../db/src/migrate';
import {
  activeTheme,
  installBuiltinPlugin,
  installBuiltinPlugins,
  installPlugin,
  listPlugins,
  setMemberTheme,
  uninstallPlugin,
} from '../src/plugins';
import { requiredTokens } from '../src/theme';

const url = process.env.TEST_DATABASE_URL;
const colors = Object.fromEntries(requiredTokens.map((name) => [name, '#336699']));
const custom = (patch: Record<string, unknown> = {}) => ({ kind: 'theme', id: 'mine', name: 'Mine', light: colors, dark: colors, ...patch });

describe.skipIf(!url)('plugins (Postgres)', () => {
  let db: Database;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    await runMigrations(url);
    db = createDb(url);
  });

  afterAll(async () => db?.close());

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE users, workspaces, mastodon_apps CASCADE`);
    const [user] = await db.insert(users).values({ email: 'a@example.com', name: 'A', passwordHash: 'x' }).returning();
    const [workspace] = await db.insert(workspaces).values({ name: 'Test' }).returning();
    userId = user!.id;
    workspaceId = workspace!.id;
    await db.insert(workspaceMembers).values({ workspaceId, userId, role: 'owner' });
  });

  const ids = async () => (await listPlugins(db, workspaceId)).map((plugin) => plugin.id);

  it('installs the built-in themes once, in shipping order', async () => {
    await installBuiltinPlugins(db, workspaceId);
    await installBuiltinPlugins(db, workspaceId);
    expect(await ids()).toEqual(['aurora', 'paper', 'blueprint']);
    const [first] = await listPlugins(db, workspaceId);
    expect(first).toMatchObject({ builtin: true, manifest: { name: 'Aurora' } });
  });

  it('uninstalls and reinstalls a built-in theme', async () => {
    await installBuiltinPlugins(db, workspaceId);
    await uninstallPlugin(db, workspaceId, 'aurora');
    expect(await ids()).toEqual(['paper', 'blueprint']);
    await installBuiltinPlugin(db, workspaceId, 'aurora');
    expect(await ids()).toEqual(['aurora', 'paper', 'blueprint']);
    await expect(installBuiltinPlugin(db, workspaceId, 'nope')).rejects.toThrow(/does not ship/);
  });

  it('installs custom themes after built-ins and updates them by id', async () => {
    await installBuiltinPlugins(db, workspaceId);
    await installPlugin(db, workspaceId, JSON.stringify(custom()));
    expect(await ids()).toEqual(['aurora', 'paper', 'blueprint', 'mine']);
    await installPlugin(db, workspaceId, custom({ name: 'Mine v2' }));
    const mine = (await listPlugins(db, workspaceId)).find((plugin) => plugin.id === 'mine');
    expect(mine).toMatchObject({ builtin: false, manifest: { name: 'Mine v2' } });
  });

  it('refuses custom themes that take a built-in id or are invalid', async () => {
    await expect(installPlugin(db, workspaceId, custom({ id: 'paper' }))).rejects.toThrow(/built-in theme/);
    await expect(installPlugin(db, workspaceId, custom({ css: 'a { background: url(https://x.example) }' }))).rejects.toThrow(/data: URLs/);
    expect(await ids()).toEqual([]);
  });

  it('skips stored manifests that no longer validate', async () => {
    await db.insert(plugins).values({ workspaceId, pluginId: 'broken', kind: 'theme', manifest: { kind: 'theme' } });
    expect(await ids()).toEqual([]);
  });

  it('keeps plugins per workspace', async () => {
    const [other] = await db.insert(workspaces).values({ name: 'Other' }).returning();
    await installPlugin(db, other!.id, custom());
    await uninstallPlugin(db, workspaceId, 'mine');
    expect(await ids()).toEqual([]);
    expect((await listPlugins(db, other!.id)).map((plugin) => plugin.id)).toEqual(['mine']);
  });

  it('uses the member’s theme while installed, otherwise the first one', async () => {
    await installBuiltinPlugins(db, workspaceId);
    await setMemberTheme(db, workspaceId, userId, 'blueprint');
    const member = await db.query.workspaceMembers.findFirst();
    expect(member!.theme).toBe('blueprint');

    expect(activeTheme(await listPlugins(db, workspaceId), member!.theme)?.id).toBe('blueprint');
    await uninstallPlugin(db, workspaceId, 'blueprint');
    expect(activeTheme(await listPlugins(db, workspaceId), member!.theme)?.id).toBe('aurora');
    for (const id of ['aurora', 'paper']) await uninstallPlugin(db, workspaceId, id);
    expect(activeTheme(await listPlugins(db, workspaceId), member!.theme)).toBeUndefined();
  });
});
