'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createOAuthState, deleteAccount, getOrRegisterMastodonApp, saveAccount } from '@postwerk/core';
import { getDb } from '@postwerk/db';
import { Bluesky, Mastodon, ProviderError } from '@postwerk/providers';
import { appUrl, mastodonRedirectUri, sandboxEnabled } from '@/lib/env';
import { requireAdmin } from '@/lib/session';

export type ConnectState = { error?: string; success?: string; values?: Record<string, string> };

function message(error: unknown): string {
  if (error instanceof ProviderError) return error.message;
  console.error(error);
  return 'Something went wrong. Please try again.';
}

export async function connectMastodon(_: ConnectState, form: FormData): Promise<ConnectState> {
  const { user, workspace } = await requireAdmin();
  let target: string;
  try {
    const instanceUrl = Mastodon.normalizeInstanceUrl(String(form.get('instance') ?? ''));
    const redirectUri = mastodonRedirectUri;
    const db = getDb();
    const app = await getOrRegisterMastodonApp(db, instanceUrl, redirectUri, 'Postwerk', appUrl);
    const state = await createOAuthState(db, { workspaceId: workspace.id, userId: user.id, provider: 'mastodon', data: { instanceUrl } });
    target = Mastodon.authorizeUrl(instanceUrl, app, redirectUri, state);
  } catch (error) {
    return { error: message(error), values: { instance: String(form.get('instance') ?? '') } };
  }
  redirect(target);
}

export async function connectBluesky(_: ConnectState, form: FormData): Promise<ConnectState> {
  const { workspace } = await requireAdmin();
  const credentials = {
    service: Bluesky.BLUESKY_DEFAULT_SERVICE,
    identifier: Bluesky.normalizeHandle(String(form.get('handle') ?? '')),
    appPassword: String(form.get('appPassword') ?? '').trim(),
  };
  const values = { handle: String(form.get('handle') ?? '') };
  if (!credentials.identifier) return { error: 'Please enter your Bluesky handle.', values };
  try {
    const profile = await Bluesky.connect(credentials);
    await saveAccount(getDb(), { workspaceId: workspace.id, provider: 'bluesky', profile, credentials, maxLength: Bluesky.BLUESKY_MAX_LENGTH });
  } catch (error) {
    return { error: message(error), values };
  }
  revalidatePath('/accounts');
  return { success: 'Bluesky account connected.' };
}

export async function connectSandbox(_: ConnectState, form: FormData): Promise<ConnectState> {
  const { workspace } = await requireAdmin();
  if (!sandboxEnabled) return { error: 'The sandbox is disabled.' };
  const name = String(form.get('name') ?? '').trim() || 'sandbox';
  await saveAccount(getDb(), { workspaceId: workspace.id, provider: 'sandbox', profile: { externalId: name, handle: `@${name}` }, credentials: { name } });
  revalidatePath('/accounts');
  return { success: 'Sandbox account added.' };
}

export async function disconnectAccount(form: FormData) {
  const { workspace } = await requireAdmin();
  await deleteAccount(getDb(), workspace.id, String(form.get('accountId')));
  revalidatePath('/accounts');
}
