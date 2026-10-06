'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  createOAuthState,
  disconnectAccount as disconnect,
  getOrRegisterMastodonApp,
  networkRoute,
  oauthClientFor,
  saveConnectedAccounts,
  startBlueskyLogin,
  startBridgeConnect,
} from '@postwerk/core';
import { getDb } from '@postwerk/db';
import { codeChallenge, generateCodeVerifier, getProvider, isProviderId, Mastodon, ProviderError } from '@postwerk/providers';
import { record } from '@/lib/audit';
import { appUrl, redirectUriFor } from '@/lib/env';
import { getMessages, localizedError } from '@/lib/i18n-server';
import { requireAdmin } from '@/lib/session';
import { commonMessages } from '@/messages/common';
import { networksMessages } from '@/messages/networks';

export type ConnectState = { error?: string; success?: string; values?: Record<string, string> };

/** Connection problems are meant for the user (in their language where Postwerk wrote them); anything else is our fault. */
async function message(error: unknown): Promise<string> {
  if (error instanceof ProviderError) return localizedError(error);
  console.error(error);
  return (await getMessages(commonMessages)).somethingWrong;
}

export async function connectMastodon(_: ConnectState, form: FormData): Promise<ConnectState> {
  const { user, workspace } = await requireAdmin();
  if (networkRoute('mastodon') !== 'native') return { error: (await getMessages(networksMessages)).notAvailable };
  let target: string;
  try {
    const instanceUrl = Mastodon.normalizeInstanceUrl(String(form.get('instance') ?? ''));
    const redirectUri = redirectUriFor('mastodon');
    const db = getDb();
    const app = await getOrRegisterMastodonApp(db, instanceUrl, redirectUri, 'Postwerk', appUrl);
    const state = await createOAuthState(db, { workspaceId: workspace.id, userId: user.id, provider: 'mastodon', data: { instanceUrl } });
    target = Mastodon.authorizeUrl(instanceUrl, app, redirectUri, state);
  } catch (error) {
    return { error: await message(error), values: { instance: String(form.get('instance') ?? '') } };
  }
  redirect(target);
}

/** Sends the browser to the user's Bluesky server to sign in (AT Protocol OAuth). */
export async function connectBluesky(_: ConnectState, form: FormData): Promise<ConnectState> {
  const { user, workspace } = await requireAdmin();
  if (networkRoute('bluesky') !== 'native') return { error: (await getMessages(networksMessages)).notAvailable };
  const handle = String(form.get('handle') ?? '');
  let target: string;
  try {
    target = await startBlueskyLogin(getDb(), { workspaceId: workspace.id, userId: user.id, handle, appUrl });
  } catch (error) {
    return { error: await message(error), values: { handle } };
  }
  redirect(target);
}

/** Networks connected with a form (Bluesky app password, Telegram bot, Discord webhook, Sandbox). */
export async function connectWithForm(providerId: string, _: ConnectState, form: FormData): Promise<ConnectState> {
  const { user, workspace } = await requireAdmin();
  const t = await getMessages(networksMessages);
  if (!isProviderId(providerId) || networkRoute(providerId) !== 'native') return { error: t.notAvailable };
  const provider = getProvider(providerId);
  if (provider.connector.kind !== 'form' && provider.connector.kind !== 'atproto') return { error: t.notForm };

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
    return { success: t.connectedNotice(accounts.map((a) => a.profile.handle).join(', ')) };
  } catch (error) {
    return { error: await message(error), values: echo };
  }
}

/** Starts the OAuth flow of a network that uses the operator's developer app. */
export async function startOAuth(providerId: string) {
  const { user, workspace } = await requireAdmin();
  if (!isProviderId(providerId)) redirect('/accounts');
  const provider = getProvider(providerId);
  const client = oauthClientFor(providerId);
  if (provider.connector.kind !== 'oauth2' || !client || networkRoute(providerId) !== 'native') {
    const t = await getMessages(networksMessages);
    redirect(`/canvas?${new URLSearchParams({ error: t.notSetUpYet(provider.name) })}#n=network:${providerId}`);
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

/**
 * Connects a network through the bridge (Zernio): sends the browser to its
 * sign-in. `reconnect` is a bridged account whose access ran out.
 */
export async function startBridgeConnectAction(network: string, reconnect?: string) {
  const { user, workspace } = await requireAdmin();
  if (!isProviderId(network)) redirect('/accounts');
  let target: string;
  try {
    if (!reconnect && networkRoute(network) !== 'bridge') throw new ProviderError((await getMessages(networksMessages)).notAvailable);
    target = await startBridgeConnect(getDb(), { workspace, userId: user.id, network, appUrl, reconnect });
  } catch (error) {
    redirect(`/canvas?${new URLSearchParams({ error: await message(error) })}#n=network:${network}`);
  }
  redirect(target);
}

export async function disconnectAccount(form: FormData) {
  const { user, workspace } = await requireAdmin();
  const back = form.get('returnTo') === '/accounts' ? '/accounts' : '/canvas';
  let deleted;
  try {
    // Bridged accounts are removed on the bridge too, so it stops billing for them.
    deleted = await disconnect(getDb(), workspace.id, String(form.get('accountId')));
  } catch (error) {
    redirect(`${back}?${new URLSearchParams({ error: await message(error) })}`);
  }
  if (deleted) {
    await record({ action: 'account.disconnected', userId: user.id, workspaceId: workspace.id, target: deleted.handle, details: { provider: deleted.provider } });
  }
  revalidatePath('/accounts');
  revalidatePath('/canvas');
}
