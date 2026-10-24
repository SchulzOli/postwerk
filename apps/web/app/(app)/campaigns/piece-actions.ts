'use server';

import { revalidatePath } from 'next/cache';
import {
  CampaignError,
  createMailing,
  deleteMailing,
  estimateMailing,
  formatMoney,
  getPiece,
  mailingService,
  parseRecipients,
  PingenError,
  savePrintPiece,
  type DeliveryProduct,
  type PrintContent,
} from '@maas/core';
import { getDb } from '@maas/db';
import { record } from '@/lib/audit';
import { getLocale, getMessages, localizedError } from '@/lib/i18n-server';
import { requireAdmin, requireSession } from '@/lib/session';
import { printMessages } from '@/messages/print';

export type PieceState = { error?: string; success?: string; saved?: number };

const text = (form: FormData, name: string) => String(form.get(name) ?? '');

function refresh(campaignId: string, pieceId: string) {
  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath(`/campaigns/${campaignId}/pieces/${pieceId}`);
  revalidatePath('/canvas');
}

/** Saves a print piece's texts, picture and options (it goes back to draft). */
export async function savePrintPieceAction(pieceId: string, _: PieceState, form: FormData): Promise<PieceState> {
  const { workspace } = await requireSession();
  let picture: string | undefined;
  try {
    const ids: unknown = JSON.parse(text(form, 'picture') || '[]');
    picture = Array.isArray(ids) && typeof ids[0] === 'string' ? ids[0] : undefined;
  } catch {
    picture = undefined;
  }
  const content: PrintContent = {
    headline: text(form, 'headline'),
    body: text(form, 'body'),
    callToAction: text(form, 'callToAction'),
    qrUrl: text(form, 'qrUrl'),
    showCharacter: form.get('showCharacter') === 'on',
    showLogo: form.get('showLogo') === 'on',
    showContact: form.get('showContact') === 'on',
    ...(picture && { imageMediaId: picture }),
    ...(form.has('widthMm') && { widthMm: Number(text(form, 'widthMm')), heightMm: Number(text(form, 'heightMm')) }),
  };
  try {
    const piece = await savePrintPiece(getDb(), workspace.id, pieceId, { title: text(form, 'title'), content });
    refresh(piece.campaignId, piece.id);
  } catch (error) {
    if (error instanceof CampaignError) return { error: await localizedError(error) };
    throw error;
  }
  return { success: (await getMessages(printMessages)).saved, saved: Date.now() };
}

export type MailingState = {
  error?: string;
  problems?: string[];
  /** The recipients text that was checked, and what it comes to. */
  checked?: { text: string; count: number; summary: string };
  sent?: number;
};

/** Checks recipients and price ("check"), or queues the letters ("send"); owners and admins only. */
export async function mailingAction(pieceId: string, _: MailingState, form: FormData): Promise<MailingState> {
  const { user, workspace } = await requireAdmin();
  const [t, locale] = await Promise.all([getMessages(printMessages), getLocale()]);
  // Browsers send textarea line breaks as CRLF.
  const recipientsText = text(form, 'recipients').replace(/\r\n/g, '\n');
  const { recipients, problems } = parseRecipients(recipientsText);
  if (problems.length > 0) return { problems: problems.slice(0, 20).map((problem) => t.problems[problem.problem](problem.line)) };
  const options = { deliveryProduct: (text(form, 'delivery') === 'cheap' ? 'cheap' : 'fast') as DeliveryProduct, color: text(form, 'color') !== 'grayscale' };
  const db = getDb();
  const piece = await getPiece(db, workspace.id, pieceId);
  if (!piece) return { error: t.approveFirst };

  if (form.get('intent') === 'send') {
    try {
      await createMailing(db, workspace.id, user.id, pieceId, recipients, options, locale);
    } catch (error) {
      if (error instanceof CampaignError) return { error: await localizedError(error) };
      throw error;
    }
    await record({ action: 'mailing.sent', userId: user.id, workspaceId: workspace.id, target: piece.title, details: { letters: recipients.length } });
    refresh(piece.campaignId, pieceId);
    return { sent: recipients.length };
  }

  const service = mailingService();
  if (!service) return { error: t.notConfigured };
  if (recipients.length === 0) return { error: (await localizedError(new CampaignError((m) => m.recipients(1000)))) };
  let summary: string;
  try {
    const estimate = await estimateMailing(service, recipients, options);
    summary = t.checked(recipients.length, estimate.currency ? formatMoney(Math.round(estimate.total * 100), estimate.currency, locale) : String(estimate.total));
  } catch (error) {
    if (!(error instanceof PingenError)) throw error;
    summary = t.checkedNoPrice(recipients.length, error.message);
  }
  return { checked: { text: recipientsText, count: recipients.length, summary } };
}

/** Deletes a mailing and its addresses (owners and admins). */
export async function deleteMailingAction(campaignId: string, pieceId: string, mailingId: string): Promise<void> {
  const { user, workspace } = await requireAdmin();
  if (await deleteMailing(getDb(), workspace.id, mailingId)) {
    const piece = await getPiece(getDb(), workspace.id, pieceId);
    await record({ action: 'mailing.deleted', userId: user.id, workspaceId: workspace.id, target: piece?.title ?? null });
  }
  refresh(campaignId, pieceId);
}
