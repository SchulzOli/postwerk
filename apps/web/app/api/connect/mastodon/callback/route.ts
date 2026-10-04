import { NextResponse, type NextRequest } from 'next/server';
import { consumeOAuthState, getOrRegisterMastodonApp, saveAccount } from '@postwerk/core';
import { getDb } from '@postwerk/db';
import { Mastodon, ProviderError } from '@postwerk/providers';
import { appUrl, mastodonRedirectUri } from '@/lib/env';
import { getSession } from '@/lib/session';

function back(params: Record<string, string>) {
  return NextResponse.redirect(`${appUrl}/accounts?${new URLSearchParams(params)}`);
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(`${appUrl}/login`);

  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const stateParam = searchParams.get('state');
  if (searchParams.get('error')) return back({ error: 'Mastodon authorization was cancelled.' });
  if (!code || !stateParam) return back({ error: 'Mastodon did not return an authorization code.' });

  const db = getDb();
  const state = await consumeOAuthState(db, stateParam, session.user.id);
  const instanceUrl = state?.data.instanceUrl;
  if (!state || state.provider !== 'mastodon' || !instanceUrl) return back({ error: 'This sign-in link has expired. Please try again.' });

  try {
    const redirectUri = mastodonRedirectUri;
    const app = await getOrRegisterMastodonApp(db, instanceUrl, redirectUri, 'Postwerk', appUrl);
    const accessToken = await Mastodon.exchangeCode(instanceUrl, app, redirectUri, code);
    const credentials = { instanceUrl, accessToken };
    const [profile, maxLength] = await Promise.all([Mastodon.fetchProfile(credentials), Mastodon.fetchMaxLength(instanceUrl)]);
    await saveAccount(db, { workspaceId: state.workspaceId, provider: 'mastodon', profile, credentials, maxLength });
    return back({ connected: profile.handle });
  } catch (error) {
    if (!(error instanceof ProviderError)) console.error(error);
    return back({ error: error instanceof ProviderError ? error.message : 'Connecting Mastodon failed.' });
  }
}
