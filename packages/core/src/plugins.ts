import { and, asc, eq } from 'drizzle-orm';
import { plugins, workspaceMembers, type Database } from '@maas/db';
import { builtinMarket, builtinMarkets, MarketError, parseMarketManifest, type MarketManifest } from './market';
import { builtinTheme, builtinThemes, parseThemeManifest, ThemeError, type ThemeManifest } from './theme';

export interface InstalledPlugin {
  id: string;
  builtin: boolean;
  installedAt: Date;
  manifest: ThemeManifest;
}

export interface InstalledMarket {
  id: string;
  builtin: boolean;
  installedAt: Date;
  manifest: MarketManifest;
}

/** Whether a plugin of either kind ships with MarketingAsAService under this id. */
const isBuiltinId = (id: string) => Boolean(builtinTheme(id) ?? builtinMarket(id));

/** Anything that can insert, so sign-up can install plugins inside its transaction. */
type Writer = Pick<Database, 'insert'>;

/**
 * A workspace's installed themes: built-ins first in shipping order (so the
 * first one is the default), then custom ones in the order they were installed.
 */
export async function listPlugins(db: Database, workspaceId: string): Promise<InstalledPlugin[]> {
  const rows = await db.query.plugins.findMany({
    where: and(eq(plugins.workspaceId, workspaceId), eq(plugins.kind, 'theme')),
    orderBy: [asc(plugins.installedAt), asc(plugins.pluginId)],
  });
  const installed = rows.flatMap((row): InstalledPlugin[] => {
    const base = { id: row.pluginId, builtin: row.builtin, installedAt: row.installedAt };
    if (row.builtin) {
      // A built-in a later MarketingAsAService version no longer ships simply disappears.
      const manifest = builtinTheme(row.pluginId);
      return manifest ? [{ ...base, manifest }] : [];
    }
    try {
      return [{ ...base, manifest: parseThemeManifest(row.manifest) }];
    } catch {
      return [];
    }
  });
  const rank = (plugin: InstalledPlugin) => (plugin.builtin ? builtinThemes.findIndex((theme) => theme.id === plugin.id) : builtinThemes.length);
  return installed.sort((a, b) => rank(a) - rank(b));
}

/** Installs every built-in plugin (new workspaces start with them). */
export async function installBuiltinPlugins(db: Writer, workspaceId: string): Promise<void> {
  await db
    .insert(plugins)
    .values(builtinThemes.map((theme) => ({ workspaceId, pluginId: theme.id, kind: 'theme' as const, builtin: true })))
    .onConflictDoNothing();
}

/** (Re)installs one built-in plugin. */
export async function installBuiltinPlugin(db: Database, workspaceId: string, id: string): Promise<ThemeManifest> {
  const theme = builtinTheme(id);
  if (!theme) throw new ThemeError((m) => m.notBuiltin);
  await db.insert(plugins).values({ workspaceId, pluginId: id, kind: 'theme', builtin: true }).onConflictDoNothing();
  return theme;
}

/**
 * Installs a custom theme from its manifest (object or JSON text). Installing
 * a theme whose id is already installed updates it in place.
 */
export async function installPlugin(db: Database, workspaceId: string, input: unknown): Promise<ThemeManifest> {
  const manifest = parseThemeManifest(input);
  if (builtinTheme(manifest.id)) throw new ThemeError((m) => m.builtinId(manifest.id));
  if (builtinMarket(manifest.id)) throw new ThemeError((m) => m.idTaken(manifest.id));
  const saved = await db
    .insert(plugins)
    .values({ workspaceId, pluginId: manifest.id, kind: 'theme', builtin: false, manifest })
    // Only a theme is updated in place; a market with the same id stays as it is.
    .onConflictDoUpdate({ target: [plugins.workspaceId, plugins.pluginId], set: { manifest, builtin: false }, setWhere: eq(plugins.kind, 'theme') })
    .returning({ id: plugins.pluginId });
  if (saved.length === 0) throw new ThemeError((m) => m.idTaken(manifest.id));
  return manifest;
}

/** Uninstalls a theme. */
export async function uninstallPlugin(db: Database, workspaceId: string, id: string): Promise<void> {
  await db.delete(plugins).where(and(eq(plugins.workspaceId, workspaceId), eq(plugins.pluginId, id), eq(plugins.kind, 'theme')));
}

/**
 * The target markets a workspace sells in: built-ins in shipping order, then
 * custom ones in the order they were installed. None are installed at first.
 */
export async function listMarkets(db: Database, workspaceId: string): Promise<InstalledMarket[]> {
  const rows = await db.query.plugins.findMany({
    where: and(eq(plugins.workspaceId, workspaceId), eq(plugins.kind, 'market')),
    orderBy: [asc(plugins.installedAt), asc(plugins.pluginId)],
  });
  const installed = rows.flatMap((row): InstalledMarket[] => {
    const base = { id: row.pluginId, builtin: row.builtin, installedAt: row.installedAt };
    if (row.builtin) {
      const manifest = builtinMarket(row.pluginId);
      return manifest ? [{ ...base, manifest }] : [];
    }
    try {
      return [{ ...base, manifest: parseMarketManifest(row.manifest) }];
    } catch {
      return [];
    }
  });
  const rank = (market: InstalledMarket) => (market.builtin ? builtinMarkets.findIndex((candidate) => candidate.id === market.id) : builtinMarkets.length);
  return installed.sort((a, b) => rank(a) - rank(b));
}

/** Installs a target market that ships with MarketingAsAService. */
export async function installBuiltinMarket(db: Database, workspaceId: string, id: string): Promise<MarketManifest> {
  const market = builtinMarket(id);
  if (!market) throw new MarketError((m) => m.notBuiltin);
  await db.insert(plugins).values({ workspaceId, pluginId: id, kind: 'market', builtin: true }).onConflictDoNothing();
  return market;
}

/**
 * Installs a custom target market from its manifest (object or JSON text).
 * Installing a market whose id is already installed updates it in place.
 */
export async function installMarket(db: Database, workspaceId: string, input: unknown): Promise<MarketManifest> {
  const manifest = parseMarketManifest(input);
  if (builtinMarket(manifest.id)) throw new MarketError((m) => m.builtinId(manifest.id));
  if (isBuiltinId(manifest.id)) throw new MarketError((m) => m.idTaken(manifest.id));
  const saved = await db
    .insert(plugins)
    .values({ workspaceId, pluginId: manifest.id, kind: 'market', builtin: false, manifest })
    // Only a market is updated in place; a theme with the same id stays as it is.
    .onConflictDoUpdate({ target: [plugins.workspaceId, plugins.pluginId], set: { manifest, builtin: false }, setWhere: eq(plugins.kind, 'market') })
    .returning({ id: plugins.pluginId });
  if (saved.length === 0) throw new MarketError((m) => m.idTaken(manifest.id));
  return manifest;
}

export async function uninstallMarket(db: Database, workspaceId: string, id: string): Promise<void> {
  await db.delete(plugins).where(and(eq(plugins.workspaceId, workspaceId), eq(plugins.pluginId, id), eq(plugins.kind, 'market')));
}

/** Remembers which installed theme a member uses; null goes back to the workspace default. */
export async function setMemberTheme(db: Database, workspaceId: string, userId: string, themeId: string | null): Promise<void> {
  await db
    .update(workspaceMembers)
    .set({ theme: themeId })
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
}

/** The theme a member sees: their choice if still installed, else the first installed theme, else none (base styles). */
export function activeTheme(installed: InstalledPlugin[], chosen: string | null | undefined): ThemeManifest | undefined {
  return (installed.find((plugin) => plugin.id === chosen) ?? installed[0])?.manifest;
}
