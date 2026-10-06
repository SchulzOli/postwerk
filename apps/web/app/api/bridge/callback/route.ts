import { NextResponse, type NextRequest } from 'next/server';
import { consumeOAuthState, finishBridgeConnect, saveConnectedAccounts } from '@postwerk/core';
import { getDb } from '@postwerk/db';
import { getProviderInfo, isBridgeId, ProviderError } from '@postwerk/providers';
import { record } from '@/lib/audit';
import { appUrl } from '@/lib/env';
import { getMessages, localizedError } from '@/lib/i18n-server';
import { getSession } from '@/lib/session';
import { networksMessages } from '@/messages/networks';

/** Back to the network on the canvas, with a notice. */
function back(params: Record<string, string>, provider?: string) {
  return NextResponse.redirect(`${appUrl}/canvas?${new URLSearchParams(params)}${provider ? `#n=network:${provider}` : ''}`);
}

/**
 * Where the bridge (Zernio) sends people back after they connected an
 * account on its pages: `state` is ours; it adds accountId and profileId,
 * or error and error_message.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(`${appUrl}/login`);
  const t = await getMessages(networksMessages);
  const params = request.nextUrl.searchParams;
  const stateParam = params.get('state');
  const db = getDb();
  const state = stateParam ? await consumeOAuthState(db, stateParam, session.user.id) : null;
  if (!state || !isBridgeId(state.data.bridge)) return back({ error: t.linkExpired });

  const network = getProviderInfo(state.provider).name;
  if (params.get('error')) {
    const reason = params.get('error_message');
    return back({ error: reason ? t.bridgeFailed({ network, reason }) : t.bridgeCancelled(network) }, state.provider);
  }
  try {
    const account = await finishBridgeConnect(state, { accountId: params.get('accountId'), profileId: params.get('profileId') });
    await saveConnectedAccounts(db, state.workspaceId, state.provider, [account], state.data.bridge);
    await record({
      action: 'account.connected',
      userId: session.user.id,
      workspaceId: state.workspaceId,
      target: account.profile.handle,
      details: { provider: state.provider, via: state.data.bridge },
    });
    return back({ connected: account.profile.handle }, state.provider);
  } catch (error) {
    if (!(error instanceof ProviderError)) console.error(error);
    return back({ error: error instanceof ProviderError ? await localizedError(error) : t.failed(network) }, state.provider);
  }
}
