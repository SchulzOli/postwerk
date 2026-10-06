import { NextResponse, type NextRequest } from 'next/server';
import { consumeOAuthState, finishBlueskyLogin, getOrRegisterMastodonApp, oauthClientFor, saveConnectedAccounts } from '@postwerk/core';
import { getDb } from '@postwerk/db';
import { getProvider, isProviderId, Mastodon, ProviderError, type ConnectedAccount } from '@postwerk/providers';
import { record } from '@/lib/audit';
import { appUrl, redirectUriFor } from '@/lib/env';
import { getMessages, localizedError } from '@/lib/i18n-server';
import { getSession } from '@/lib/session';
import { networksMessages } from '@/messages/networks';

/** Back to the network on the canvas, with a notice. */
function back(params: Record<string, string>, provider?: string) {
  return NextResponse.redirect(`${appUrl}/canvas?${new URLSearchParams(params)}${provider ? `#n=network:${provider}` : ''}`);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerId } = await params;
  if (!isProviderId(providerId)) return new NextResponse('Not found', { status: 404 });
  // Bluesky's development (loopback) client comes back to 127.0.0.1; continue on the
  // app's own address, where the session cookie is.
  // (nextUrl names the server's own host, so look at the Host header the browser sent.)
  if (new URL(appUrl).hostname === 'localhost' && request.headers.get('host')?.startsWith('127.0.0.1')) {
    return NextResponse.redirect(`${appUrl}${request.nextUrl.pathname}${request.nextUrl.search}`);
  }
  const session = await getSession();
  if (!session) return NextResponse.redirect(`${appUrl}/login`);

  const provider = getProvider(providerId);
  const t = await getMessages(networksMessages);
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const stateParam = searchParams.get('state');
  if (searchParams.get('error')) return back({ error: t.cancelled(provider.name) }, providerId);
  if (!code || !stateParam) return back({ error: t.noCode(provider.name) }, providerId);

  const db = getDb();
  const state = await consumeOAuthState(db, stateParam, session.user.id);
  if (!state || state.provider !== providerId) return back({ error: t.linkExpired }, providerId);

  try {
    const redirectUri = redirectUriFor(providerId);
    let accounts: ConnectedAccount<unknown>[];
    if (providerId === 'mastodon') {
      const instanceUrl = state.data.instanceUrl!;
      const app = await getOrRegisterMastodonApp(db, instanceUrl, redirectUri, 'Postwerk', appUrl);
      const credentials = { instanceUrl, accessToken: await Mastodon.exchangeCode(instanceUrl, app, redirectUri, code) };
      const [profile, maxLength] = await Promise.all([Mastodon.fetchProfile(credentials), Mastodon.fetchMaxLength(instanceUrl)]);
      accounts = [{ profile, credentials, limits: { maxLength } }];
    } else if (providerId === 'bluesky') {
      accounts = [await finishBlueskyLogin(db, state.data, { code, iss: searchParams.get('iss') })];
    } else {
      const client = oauthClientFor(providerId);
      if (provider.connector.kind !== 'oauth2' || !client) return back({ error: t.notSetUp(provider.name) }, providerId);
      accounts = await provider.connector.exchange(client, { code, redirectUri, codeVerifier: state.data.codeVerifier });
    }
    await saveConnectedAccounts(db, state.workspaceId, providerId, accounts);
    for (const account of accounts) {
      await record({ action: 'account.connected', userId: session.user.id, workspaceId: state.workspaceId, target: account.profile.handle, details: { provider: providerId } });
    }
    return back({ connected: accounts.map((account) => account.profile.handle).join(', ') }, providerId);
  } catch (error) {
    if (!(error instanceof ProviderError)) console.error(error);
    return back({ error: error instanceof ProviderError ? await localizedError(error) : t.failed(provider.name) }, providerId);
  }
}
