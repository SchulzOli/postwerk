'use server';

import { revalidatePath } from 'next/cache';
import { CampaignError, getPiece, PartnerCenterError, saveListingPiece, saveScreenshotPiece, sendListing, type ScreenshotBackground } from '@maas/core';
import { record } from '@/lib/audit';
import { getDb } from '@maas/db';
import { getMessages, localizedError } from '@/lib/i18n-server';
import { requireAdmin, requireSession } from '@/lib/session';
import { listingMessages } from '@/messages/listing';

export type ListingState = { error?: string; success?: string; saved?: number };

const text = (form: FormData, name: string) => String(form.get(name) ?? '');

/** Name and link rows of the form, in order. */
function links(form: FormData, prefix: string) {
  const names = form.getAll(`${prefix}Name`).map(String);
  const urls = form.getAll(`${prefix}Url`).map(String);
  return names.map((name, index) => ({ name, url: urls[index] ?? '' }));
}

async function refresh(pieceId: string) {
  const { workspace } = await requireSession();
  const piece = await getPiece(getDb(), workspace.id, pieceId);
  if (!piece) return;
  revalidatePath(`/campaigns/${piece.campaignId}`);
  // A screenshot changes its listing's checks too.
  revalidatePath(`/campaigns/${piece.campaignId}/pieces`, 'layout');
}

async function failure(error: unknown): Promise<ListingState> {
  if (error instanceof CampaignError || error instanceof PartnerCenterError) return { error: await localizedError(error) };
  throw error;
}

/** Writes an approved listing's texts into the offer's draft in Partner Center (owners and admins). */
export async function sendListingAction(pieceId: string): Promise<ListingState> {
  const { user, workspace } = await requireAdmin();
  try {
    await sendListing(getDb(), workspace.id, pieceId);
  } catch (error) {
    return failure(error);
  }
  const piece = await getPiece(getDb(), workspace.id, pieceId);
  await record({ action: 'listing.sent', userId: user.id, workspaceId: workspace.id, target: piece?.title ?? null });
  return { success: (await getMessages(listingMessages)).sent };
}

/** Saves a marketplace listing (it goes back to draft). */
export async function saveListingAction(pieceId: string, _: ListingState, form: FormData): Promise<ListingState> {
  const { workspace } = await requireSession();
  const texts: Record<string, string> = {};
  for (const [key, value] of form.entries()) if (key.startsWith('text:') && typeof value === 'string') texts[key.slice(5)] = value;
  try {
    await saveListingPiece(getDb(), workspace.id, pieceId, {
      title: text(form, 'title'),
      content: { texts, keywords: text(form, 'keywords').split(/[,\n]/), videos: links(form, 'video'), documents: links(form, 'document') },
    });
  } catch (error) {
    return failure(error);
  }
  await refresh(pieceId);
  return { success: (await getMessages(listingMessages)).saved, saved: Date.now() };
}

/** Saves a listing screenshot (it goes back to draft). */
export async function saveScreenshotAction(pieceId: string, _: ListingState, form: FormData): Promise<ListingState> {
  const { workspace } = await requireSession();
  let capture: string | null = null;
  try {
    const ids: unknown = JSON.parse(text(form, 'capture') || '[]');
    capture = Array.isArray(ids) && typeof ids[0] === 'string' ? ids[0] : null;
  } catch {
    capture = null;
  }
  try {
    await saveScreenshotPiece(getDb(), workspace.id, pieceId, {
      title: text(form, 'title'),
      content: { captureMediaId: capture, headline: text(form, 'headline'), caption: text(form, 'caption'), background: text(form, 'background') as ScreenshotBackground },
    });
  } catch (error) {
    return failure(error);
  }
  await refresh(pieceId);
  return { success: (await getMessages(listingMessages)).screenshotSaved, saved: Date.now() };
}
