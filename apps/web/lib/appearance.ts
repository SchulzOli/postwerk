import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { activeTheme, listPlugins, type InstalledPlugin } from '@postwerk/core';
import type { ColorMode, ThemeManifest } from '@postwerk/core/theme';
import { getDb } from '@postwerk/db';
import { MODE_COOKIE, parseColorMode } from './color-mode';
import { getSession } from './session';

export interface Appearance {
  mode: ColorMode;
  /** The signed-in member's theme; undefined shows the base styles (signed out, or no theme installed). */
  theme: ThemeManifest | undefined;
  installed: InstalledPlugin[];
}

/** How the current request should look. Cached per request. */
export const getAppearance = cache(async (): Promise<Appearance> => {
  const mode = parseColorMode((await cookies()).get(MODE_COOKIE)?.value);
  const session = await getSession();
  if (!session) return { mode, theme: undefined, installed: [] };
  const installed = await listPlugins(getDb(), session.workspace.id);
  return { mode, theme: activeTheme(installed, session.theme), installed };
});
