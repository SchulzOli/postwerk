'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createOAuthState, deleteAccount, getOrRegisterMastodonApp, isProviderAvailable, oauthClientFor, saveConnectedAccounts, startBlueskyLogin } from '@postwerk/core';
import { getDb } from '@postwerk/db';
import { codeChallenge, generateCodeVerifier, getProvider, isProviderId, Mastodon, ProviderError } from '@postwerk/providers';
import { record } from '@/lib/audit';
import { appUrl, redirectUriFor } from '@/lib/env';
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
    const redirectUri = redirectUriFor('mastodon');
    const db = getDb();
    const app = await getOrRegisterMastodonApp(db, instanceUrl, redirectUri, 'Postwerk', appUrl);
    const state = await createOAuthState(db, { workspaceId: workspace.id, userId: user.id, provider: 'mastodon', data: { instanceUrl } });
    target = Mastodon.authorizeUrl(instanceUrl, app, redirectUri, state);
  } catch (error) {
    return { error: message(error), values: { instance: String(form.get('instance') ?? '') } };
  }
  redirect(target);
}

/** Sends the browser to the user's Bluesky server to sign in (AT Protocol OAuth). */
export async function connectBluesky(_: ConnectState, form: FormData): Promise<ConnectState> {
  const { user, workspace } = await requireAdmin();
  const handle = String(form.get('handle') ?? '');
  let target: string;
  try {
    target = await startBlueskyLogin(getDb(), { workspaceId: workspace.id, userId: user.id, handle, appUrl });
  } catch (error) {
    return { error: message(error), values: { handle } };
  }
  redirect(target);
}

/** Networks connected with a form (Bluesky app password, Telegram bot, Discord webhook, Sandbox). */
export async function connectWithForm(providerId: string, _: ConnectState, form: FormData): Promise<ConnectState> {
  const { user, workspace } = await requireAdmin();
  if (!isProviderId(providerId) || !isProviderAvailable(providerId)) return { error: 'This network is not available.' };
  const provider = getProvider(providerId);
  if (provider.connector.kind !== 'form' && provider.connector.kind !== 'atproto') return { error: 'This network is not connected with a form.' };

  const values: Record<string, string> = {};
  const echo: Record<string, string> = {};
  for (const field of provider.connector.fields) {
    values[field.name] = String(form.get(field.name) ?? '');
    if (field.type !== 'password') echo[field.name] = values[field.name]!;
  }
  try {
    const accounts = await provider.connector.connect(values);
    await saveConnectedAccounts(getDb(), workspace.id, providerId, accounts);
    for (const account of accounts) {
      await record({ action: 'account.connected', userId: user.id, workspaceId: workspace.id, target: account.profile.handle, details: { provider: providerId } });
    }
    revalidatePath('/accounts');
    revalidatePath('/canvas');
    return { success: `Connected ${accounts.map((a) => a.profile.handle).join(', ')}.` };
  } catch (error) {
    return { error: message(error), values: echo };
  }
}

/** Starts the OAuth flow of a network that uses the operator's developer app. */
export async function startOAuth(providerId: string) {
  const { user, workspace } = await requireAdmin();
  if (!isProviderId(providerId)) redirect('/accounts');
  const provider = getProvider(providerId);
  const client = oauthClientFor(providerId);
  if (provider.connector.kind !== 'oauth2' || !client) {
    redirect(`/canvas?${new URLSearchParams({ error: `${provider.name} is not set up on this server yet.` })}#n=network:${providerId}`);
  }

  const codeVerifier = provider.connector.pkce ? generateCodeVerifier() : undefined;
  const state = await createOAuthState(getDb(), {
    workspaceId: workspace.id,
    userId: user.id,
    provider: providerId,
    data: codeVerifier ? { codeVerifier } : {},
  });
  redirect(
    provider.connector.authorizeUrl(client, {
      redirectUri: redirectUriFor(providerId),
      state,
      codeChallenge: codeVerifier ? await codeChallenge(codeVerifier) : undefined,
    }),
  );
}

export async function disconnectAccount(form: FormData) {
  const { user, workspace } = await requireAdmin();
  const deleted = await deleteAccount(getDb(), workspace.id, String(form.get('accountId')));
  if (deleted) {
    await record({ action: 'account.disconnected', userId: user.id, workspaceId: workspace.id, target: deleted.handle, details: { provider: deleted.provider } });
  }
  revalidatePath('/accounts');
  revalidatePath('/canvas');
}
