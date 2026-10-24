'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { adsSetup, CampaignError, createOAuthState, getPiece, launchAd, parseMoney, removeAdAccount, saveAdPiece, setAdRunning, type AdContent } from '@maas/core';
import { getDb } from '@maas/db';
import { authorizeUrl, GOOGLE_ADS_SCOPE, metaAdsAuthorizeUrl, ProviderError, type AdPlatformId } from '@maas/providers';
import { record } from '@/lib/audit';
import { adsRedirectUriFor } from '@/lib/env';
import { getMessages, localizedError } from '@/lib/i18n-server';
import { requireAdmin, requireSession } from '@/lib/session';
import { adsMessages } from '@/messages/ads';
import type { PieceState } from './piece-actions';

const text = (form: FormData, name: string) => String(form.get(name) ?? '');

function refresh(campaignId?: string, pieceId?: string) {
  revalidatePath('/campaigns');
  if (campaignId) revalidatePath(`/campaigns/${campaignId}`);
  if (campaignId && pieceId) revalidatePath(`/campaigns/${campaignId}/pieces/${pieceId}`);
}

/** Errors people can act on: ours, and the platform's own words. */
async function failure(error: unknown): Promise<PieceState> {
  if (error instanceof CampaignError || error instanceof ProviderError) return { error: await localizedError(error) };
  throw error;
}

/** Sends an owner or admin to the platform's sign-in to connect ad accounts. */
export async function startAdConnectAction(platform: AdPlatformId) {
  const { user, workspace } = await requireAdmin();
  const setup = adsSetup();
  const t = await getMessages(adsMessages);
  const redirectUri = adsRedirectUriFor(platform);
  if (platform === 'google_ads' && setup.google_ads) {
    // The state row is keyed by the network whose app signs in.
    const state = await createOAuthState(getDb(), { workspaceId: workspace.id, userId: user.id, provider: 'youtube', data: { ads: 'google_ads' } });
    redirect(
      authorizeUrl('https://accounts.google.com/o/oauth2/v2/auth', {
        client_id: setup.google_ads.client.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        state,
        scope: GOOGLE_ADS_SCOPE,
        access_type: 'offline',
        prompt: 'consent',
      }),
    );
  }
  if (platform === 'meta_ads' && setup.meta_ads) {
    const state = await createOAuthState(getDb(), { workspaceId: workspace.id, userId: user.id, provider: 'facebook', data: { ads: 'meta_ads' } });
    redirect(metaAdsAuthorizeUrl(setup.meta_ads.client, redirectUri, state));
  }
  redirect(`/campaigns?${new URLSearchParams({ error: t.notSetUp(t.platforms[platform]) })}`);
}

export async function removeAdAccountAction(adAccountId: string): Promise<PieceState> {
  const { user, workspace } = await requireAdmin();
  try {
    const removed = await removeAdAccount(getDb(), workspace.id, adAccountId);
    if (removed) await record({ action: 'ads.removed', userId: user.id, workspaceId: workspace.id, target: removed.name });
  } catch (error) {
    return failure(error);
  }
  refresh();
  return {};
}

/** Saves an ad's texts, link, picture or video (it goes back to draft). */
export async function saveAdPieceAction(pieceId: string, _: PieceState, form: FormData): Promise<PieceState> {
  const { workspace } = await requireSession();
  let picture: string | undefined;
  try {
    const ids: unknown = JSON.parse(text(form, 'picture') || '[]');
    picture = Array.isArray(ids) && typeof ids[0] === 'string' ? ids[0] : undefined;
  } catch {
    picture = undefined;
  }
  const content: AdContent = {
    headlines: form.getAll('headline').map(String),
    descriptions: form.getAll('description').map(String),
    longHeadlines: form.getAll('longHeadline').map(String),
    finalUrl: text(form, 'finalUrl'),
    callToAction: text(form, 'callToAction'),
    path1: text(form, 'path1'),
    path2: text(form, 'path2'),
    keywords: text(form, 'keywords').split(/\r?\n/),
    ...(picture && { imageMediaId: picture }),
    ...(text(form, 'spot') && { spotId: text(form, 'spot') }),
    ...(!text(form, 'spot') && text(form, 'youtube').trim() && { youtubeVideoId: text(form, 'youtube') }),
  };
  try {
    const piece = await saveAdPiece(getDb(), workspace.id, pieceId, { title: text(form, 'title'), content });
    refresh(piece.campaignId, piece.id);
  } catch (error) {
    return failure(error);
  }
  return { success: (await getMessages(adsMessages)).saved, saved: Date.now() };
}

/** Creates the ad's campaign on its platform, paused (owners and admins: it can spend money once started). */
export async function launchAdAction(pieceId: string, _: PieceState, form: FormData): Promise<PieceState> {
  const { user, workspace } = await requireAdmin();
  const t = await getMessages(adsMessages);
  const budget = parseMoney(text(form, 'budget'));
  if (budget === null) return { error: t.budgetInvalid };
  const db = getDb();
  try {
    const launch = await launchAd(db, workspace, user.id, pieceId, {
      adAccountId: text(form, 'account'),
      budgetCents: budget,
      startsOn: text(form, 'startsOn'),
      endsOn: text(form, 'endsOn'),
      countries: form.getAll('countries').map(String),
      language: text(form, 'language'),
      pageId: text(form, 'page') || undefined,
    });
    const piece = await getPiece(db, workspace.id, pieceId);
    await record({ action: 'ads.launched', userId: user.id, workspaceId: workspace.id, target: piece?.title ?? launch.externalId });
    refresh(piece?.campaignId, pieceId);
  } catch (error) {
    return failure(error);
  }
  return { saved: Date.now() };
}

/** Starts or pauses a launched ad campaign. */
export async function setAdRunningAction(pieceId: string, launchId: string, running: boolean): Promise<PieceState> {
  const { user, workspace } = await requireAdmin();
  const db = getDb();
  try {
    await setAdRunning(db, workspace.id, launchId, running);
  } catch (error) {
    return failure(error);
  }
  const piece = await getPiece(db, workspace.id, pieceId);
  await record({ action: running ? 'ads.started' : 'ads.paused', userId: user.id, workspaceId: workspace.id, target: piece?.title ?? null });
  refresh(piece?.campaignId, pieceId);
  return {};
}
