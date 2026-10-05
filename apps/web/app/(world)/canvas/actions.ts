'use server';

import { revalidatePath } from 'next/cache';
import {
  builtinTheme,
  createFlow,
  deleteFlow,
  installBuiltinPlugin,
  installPlugin,
  listPlugins,
  parseFlowGraph,
  saveCanvasPositions,
  saveFlow,
  setMemberTheme,
  ThemeError,
  uninstallPlugin,
} from '@postwerk/core';
import { getDb } from '@postwerk/db';
import { requireAdmin, requireSession } from '@/lib/session';

export async function createFlowAction(input: { name: string; x: number; y: number }) {
  const { workspace } = await requireSession();
  const flow = await createFlow(getDb(), workspace.id, input);
  revalidatePath('/canvas');
  return { id: flow.id, name: flow.name, graph: parseFlowGraph(flow.graph), x: flow.x, y: flow.y };
}

export async function saveFlowAction(flowId: string, input: { name?: string; graph?: unknown; x?: number; y?: number }) {
  const { workspace } = await requireSession();
  try {
    return { ok: await saveFlow(getDb(), workspace.id, flowId, input) };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function deleteFlowAction(flowId: string) {
  const { workspace } = await requireSession();
  await deleteFlow(getDb(), workspace.id, flowId);
  revalidatePath('/canvas');
}

export async function savePositionsAction(positions: { key: string; x: number; y: number }[]) {
  const { workspace } = await requireSession();
  await saveCanvasPositions(getDb(), workspace.id, positions);
}

// ---------------------------------------------------------------- plugins
// Themes change the root layout (the <style> and <html data-theme>), so every page is revalidated.

export type PluginState = { error?: string; success?: string };

/** Installs (or updates) a custom theme and switches the installer to it, so edits show right away. */
export async function installPluginAction(_: PluginState, form: FormData): Promise<PluginState> {
  const { user, workspace } = await requireAdmin();
  const source = String(form.get('manifest') ?? '');
  if (!source.trim()) return { error: 'Choose a theme file or paste its JSON first.' };
  try {
    const db = getDb();
    const theme = await installPlugin(db, workspace.id, source);
    await setMemberTheme(db, workspace.id, user.id, theme.id);
    revalidatePath('/', 'layout');
    return { success: `${theme.name} is installed and in use.` };
  } catch (error) {
    if (error instanceof ThemeError) return { error: error.message };
    throw error;
  }
}

export async function installBuiltinPluginAction(pluginId: string) {
  const { workspace } = await requireAdmin();
  if (!builtinTheme(pluginId)) return;
  await installBuiltinPlugin(getDb(), workspace.id, pluginId);
  revalidatePath('/', 'layout');
}

export async function uninstallPluginAction(pluginId: string) {
  const { workspace } = await requireAdmin();
  await uninstallPlugin(getDb(), workspace.id, pluginId);
  revalidatePath('/', 'layout');
}

/** Any member picks their own theme among the installed ones. */
export async function chooseThemeAction(pluginId: string) {
  const { user, workspace } = await requireSession();
  const db = getDb();
  if (!(await listPlugins(db, workspace.id)).some((plugin) => plugin.id === pluginId)) return;
  await setMemberTheme(db, workspace.id, user.id, pluginId);
  revalidatePath('/', 'layout');
}
