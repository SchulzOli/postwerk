import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, plugins, users, workspaceMembers, workspaces, type Database } from '@maas/db';
import { runMigrations } from '../../db/src/migrate';
import {
  activeTheme,
  installBuiltinMarket,
  installBuiltinPlugin,
  installBuiltinPlugins,
  installMarket,
  installPlugin,
  listMarkets,
  listPlugins,
  setMemberTheme,
  uninstallMarket,
  uninstallPlugin,
} from '../src/plugins';
import { requiredTokens } from '../src/theme';

const url = process.env.TEST_DATABASE_URL;
const colors = Object.fromEntries(requiredTokens.map((name) => [name, '#336699']));
const custom = (patch: Record<string, unknown> = {}) => ({ kind: 'theme', id: 'mine', name: 'Mine', light: colors, dark: colors, ...patch });
const text = (en: string) => ({ en, de: en });
const market = (patch: Record<string, unknown> = {}) => ({
  kind: 'market',
  id: 'shop-apps',
  name: text('Shop apps'),
  description: text('Apps for online shops.'),
  product: { name: text('Shop app') },
  marketplace: {
    name: 'App Store',
    url: 'https://apps.example.com',
    listing: { texts: [{ id: 'name', label: text('Name'), max: 30 }], screenshots: { min: 1, max: 3, width: 1600, height: 900 } },
  },
  studio: text('Name the shop system correctly.'),
  results: { reach: text('Visits'), clicks: text('Installs started'), leads: text('Installs') },
  ...patch,
});

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

  describe('target markets', () => {
    const marketIds = async (id = workspaceId) => (await listMarkets(db, id)).map((entry) => entry.id);

    it('installs none in a new workspace, and several on request', async () => {
      await installBuiltinPlugins(db, workspaceId);
      expect(await marketIds()).toEqual([]);
      await installMarket(db, workspaceId, JSON.stringify(market()));
      await installBuiltinMarket(db, workspaceId, 'business-central');
      await installBuiltinMarket(db, workspaceId, 'business-central');
      expect(await marketIds()).toEqual(['business-central', 'shop-apps']);
      const [first] = await listMarkets(db, workspaceId);
      expect(first).toMatchObject({ builtin: true, manifest: { marketplace: { name: 'AppSource' } } });
      await expect(installBuiltinMarket(db, workspaceId, 'nope')).rejects.toThrow(/does not ship/);
    });

    it('keeps themes and markets apart', async () => {
      await installBuiltinPlugins(db, workspaceId);
      await installBuiltinMarket(db, workspaceId, 'business-central');
      expect(await ids()).toEqual(['aurora', 'paper', 'blueprint']);
      // Uninstalling a theme by a market's id, or the other way round, changes nothing.
      await uninstallPlugin(db, workspaceId, 'business-central');
      await uninstallMarket(db, workspaceId, 'aurora');
      expect(await marketIds()).toEqual(['business-central']);
      expect(await ids()).toEqual(['aurora', 'paper', 'blueprint']);
    });

    it('never lets one kind overwrite the other through a shared id', async () => {
      await installPlugin(db, workspaceId, custom({ id: 'shared' }));
      await expect(installMarket(db, workspaceId, market({ id: 'shared' }))).rejects.toThrow(/Another plugin already uses the id “shared”/);
      await installMarket(db, workspaceId, market());
      await expect(installPlugin(db, workspaceId, custom({ id: 'shop-apps' }))).rejects.toThrow(/Another plugin already uses the id “shop-apps”/);
      await expect(installPlugin(db, workspaceId, custom({ id: 'business-central' }))).rejects.toThrow(/Another plugin already uses/);
      await expect(installMarket(db, workspaceId, market({ id: 'paper' }))).rejects.toThrow(/Another plugin already uses/);
      await expect(installMarket(db, workspaceId, market({ id: 'business-central' }))).rejects.toThrow(/built-in market/);
      expect(await ids()).toEqual(['shared']);
      expect(await marketIds()).toEqual(['shop-apps']);
    });

    it('updates a custom market in place and skips stored ones that no longer validate', async () => {
      await installMarket(db, workspaceId, market());
      await installMarket(db, workspaceId, market({ name: text('Shop apps v2') }));
      const [entry] = await listMarkets(db, workspaceId);
      expect(entry).toMatchObject({ builtin: false, manifest: { name: { en: 'Shop apps v2' } } });
      await db.insert(plugins).values({ workspaceId, pluginId: 'broken', kind: 'market', manifest: { kind: 'market' } });
      expect(await marketIds()).toEqual(['shop-apps']);
    });

    it('keeps markets per workspace', async () => {
      const [other] = await db.insert(workspaces).values({ name: 'Other' }).returning();
      await installBuiltinMarket(db, other!.id, 'business-central');
      expect(await marketIds()).toEqual([]);
      expect(await marketIds(other!.id)).toEqual(['business-central']);
      await uninstallMarket(db, other!.id, 'business-central');
      expect(await marketIds(other!.id)).toEqual([]);
    });
  });
});
