import { and, asc, eq } from 'drizzle-orm';
import { plugins, workspaceMembers, type Database } from '@postwerk/db';
import { builtinTheme, builtinThemes, parseThemeManifest, ThemeError, type ThemeManifest } from './theme';

export interface InstalledPlugin {
  id: string;
  builtin: boolean;
  installedAt: Date;
  manifest: ThemeManifest;
}

/** Anything that can insert, so sign-up can install plugins inside its transaction. */
type Writer = Pick<Database, 'insert'>;

/**
 * A workspace's installed plugins: built-ins first in shipping order (so the
 * first one is the default), then custom ones in the order they were installed.
 */
export async function listPlugins(db: Database, workspaceId: string): Promise<InstalledPlugin[]> {
  const rows = await db.query.plugins.findMany({ where: eq(plugins.workspaceId, workspaceId), orderBy: [asc(plugins.installedAt), asc(plugins.pluginId)] });
  const installed = rows.flatMap((row): InstalledPlugin[] => {
    const base = { id: row.pluginId, builtin: row.builtin, installedAt: row.installedAt };
    if (row.builtin) {
      // A built-in a later Postwerk version no longer ships simply disappears.
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
  if (builtinTheme(manifest.id)) {
    throw new ThemeError((m) => m.builtinId(manifest.id));
  }
  await db
    .insert(plugins)
    .values({ workspaceId, pluginId: manifest.id, kind: 'theme', builtin: false, manifest })
    .onConflictDoUpdate({ target: [plugins.workspaceId, plugins.pluginId], set: { manifest, builtin: false } });
  return manifest;
}

export async function uninstallPlugin(db: Database, workspaceId: string, id: string): Promise<void> {
  await db.delete(plugins).where(and(eq(plugins.workspaceId, workspaceId), eq(plugins.pluginId, id)));
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
