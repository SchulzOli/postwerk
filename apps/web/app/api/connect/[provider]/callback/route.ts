import { NextResponse, type NextRequest } from 'next/server';
import { consumeOAuthState, getOrRegisterMastodonApp, oauthClientFor, saveConnectedAccounts } from '@postwerk/core';
import { getDb } from '@postwerk/db';
import { getProvider, isProviderId, Mastodon, ProviderError, type ConnectedAccount } from '@postwerk/providers';
import { appUrl, redirectUriFor } from '@/lib/env';
import { getSession } from '@/lib/session';

function back(params: Record<string, string>) {
  return NextResponse.redirect(`${appUrl}/accounts?${new URLSearchParams(params)}`);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerId } = await params;
  if (!isProviderId(providerId)) return new NextResponse('Not found', { status: 404 });
  const session = await getSession();
  if (!session) return NextResponse.redirect(`${appUrl}/login`);

  const provider = getProvider(providerId);
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const stateParam = searchParams.get('state');
  if (searchParams.get('error')) return back({ error: `${provider.name} authorization was cancelled.` });
  if (!code || !stateParam) return back({ error: `${provider.name} did not return an authorization code.` });

  const db = getDb();
  const state = await consumeOAuthState(db, stateParam, session.user.id);
  if (!state || state.provider !== providerId) return back({ error: 'This sign-in link has expired. Please try again.' });

  try {
    const redirectUri = redirectUriFor(providerId);
    let accounts: ConnectedAccount<unknown>[];
    if (providerId === 'mastodon') {
      const instanceUrl = state.data.instanceUrl!;
      const app = await getOrRegisterMastodonApp(db, instanceUrl, redirectUri, 'Postwerk', appUrl);
      const credentials = { instanceUrl, accessToken: await Mastodon.exchangeCode(instanceUrl, app, redirectUri, code) };
      const [profile, maxLength] = await Promise.all([Mastodon.fetchProfile(credentials), Mastodon.fetchMaxLength(instanceUrl)]);
      accounts = [{ profile, credentials, limits: { maxLength } }];
    } else {
      const client = oauthClientFor(providerId);
      if (provider.connector.kind !== 'oauth2' || !client) return back({ error: `${provider.name} is not set up on this server.` });
      accounts = await provider.connector.exchange(client, { code, redirectUri, codeVerifier: state.data.codeVerifier });
    }
    await saveConnectedAccounts(db, state.workspaceId, providerId, accounts);
    return back({ connected: accounts.map((account) => account.profile.handle).join(', ') });
  } catch (error) {
    if (!(error instanceof ProviderError)) console.error(error);
    return back({ error: error instanceof ProviderError ? error.message : `Connecting ${provider.name} failed.` });
  }
}
