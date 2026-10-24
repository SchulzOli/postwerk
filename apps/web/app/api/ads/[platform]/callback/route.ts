import { NextResponse, type NextRequest } from 'next/server';
import { adPlatform, adsSetup, consumeOAuthState, saveAdAccounts } from '@maas/core';
import { getDb } from '@maas/db';
import { AD_PLATFORMS, exchangeMetaAdsCode, GOOGLE_TOKEN_URL, ProviderError, tokenRequest, type AdPlatformId } from '@maas/providers';
import { record } from '@/lib/audit';
import { adsRedirectUriFor, appUrl } from '@/lib/env';
import { getMessages, localizedError } from '@/lib/i18n-server';
import { getSession } from '@/lib/session';
import { adsMessages } from '@/messages/ads';

/** Back to the campaigns, where the ad accounts are listed, with a notice. */
const back = (params: Record<string, string>) => NextResponse.redirect(`${appUrl}/campaigns?${new URLSearchParams(params)}#ad-accounts`);

/** Google Ads or Meta sends people back here after they allowed access to their ad accounts. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (!(AD_PLATFORMS as string[]).includes(platform)) return new NextResponse('Not found', { status: 404 });
  const id = platform as AdPlatformId;
  const session = await getSession();
  if (!session) return NextResponse.redirect(`${appUrl}/login`);
  const t = await getMessages(adsMessages);
  const name = t.platforms[id];
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const stateParam = searchParams.get('state');
  if (searchParams.get('error') || !code || !stateParam) return back({ error: t.cancelled });

  const db = getDb();
  const state = await consumeOAuthState(db, stateParam, session.user.id);
  if (!state || state.data.ads !== id) return back({ error: t.linkExpired });
  const setup = adsSetup();
  const client = adPlatform(id);
  if (!client || !setup[id]) return back({ error: t.notSetUp(name) });

  try {
    const redirectUri = adsRedirectUriFor(id);
    let accessToken: string;
    let credentials;
    if (id === 'google_ads') {
      const tokens = await tokenRequest(GOOGLE_TOKEN_URL, setup.google_ads!.client, { grant_type: 'authorization_code', code, redirect_uri: redirectUri });
      if (!tokens.refreshToken) return back({ error: t.noRefreshToken });
      accessToken = tokens.accessToken;
      credentials = { refreshToken: tokens.refreshToken, accessToken: tokens.accessToken, expiresAt: tokens.expiresAt };
    } else {
      credentials = await exchangeMetaAdsCode(setup.meta_ads!.client, code, redirectUri, setup.meta_ads!.baseUrl);
      accessToken = credentials.accessToken;
    }
    const accounts = await client.listAccounts(accessToken);
    if (accounts.length === 0) return back({ error: t.noAccountsFound(name) });
    const saved = await saveAdAccounts(db, state.workspaceId, id, accounts, credentials, session.user.id);
    for (const account of saved) await record({ action: 'ads.connected', userId: session.user.id, workspaceId: state.workspaceId, target: `${name}: ${account.name}` });
    return back({ notice: t.connected(saved.map((account) => account.name).join(', ')) });
  } catch (error) {
    if (!(error instanceof ProviderError)) console.error(error);
    return back({ error: error instanceof ProviderError ? await localizedError(error) : t.failed(name) });
  }
}
