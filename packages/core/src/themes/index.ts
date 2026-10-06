import type { ThemeManifest } from '../theme';
import { aurora } from './aurora';
import { blueprint } from './blueprint';
import { paper } from './paper';

/**
 * Themes that ship with Postwerk. Every new workspace starts with them
 * installed (the first one is the default); they can be uninstalled and
 * reinstalled like any other plugin, and update together with Postwerk.
 */
export const builtinThemes: readonly ThemeManifest[] = [aurora, paper, blueprint];

export function builtinTheme(id: string): ThemeManifest | undefined {
  return builtinThemes.find((theme) => theme.id === id);
}
