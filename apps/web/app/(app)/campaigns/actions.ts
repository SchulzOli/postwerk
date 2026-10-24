'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  addResult,
  CampaignError,
  CHANNELS,
  createCampaign,
  createPiece,
  deleteCampaign,
  deletePiece,
  deleteResult,
  getPiece,
  parseMoney,
  setPieceStatus,
  updateCampaign,
  type CampaignInput,
  type CampaignStatus,
  type Goal,
  type PieceKind,
  type PieceStatus,
} from '@maas/core';
import { getDb } from '@maas/db';
import { record } from '@/lib/audit';
import { getMessages, localizedError } from '@/lib/i18n-server';
import { requireAdmin, requireSession } from '@/lib/session';
import { campaignsMessages } from '@/messages/campaigns';

export type CampaignState = { error?: string; success?: string; saved?: number };

const text = (form: FormData, name: string) => String(form.get(name) ?? '');

/** Reads an amount field in cents; a message when it is not an amount. */
async function money(form: FormData, name: string, label: string): Promise<number | string> {
  const cents = parseMoney(text(form, name));
  return cents ?? (await getMessages(campaignsMessages)).amountInvalid(label);
}

function refresh(campaignId?: string) {
  revalidatePath('/campaigns');
  if (campaignId) revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath('/canvas');
}

/** Turns a CampaignError into the form's message; anything else is a real failure. */
async function failure(error: unknown): Promise<CampaignState> {
  if (error instanceof CampaignError) return { error: await localizedError(error) };
  throw error;
}

/** Starts a campaign from a name, goal, dates and budget, then opens it. */
export async function createCampaignAction(_: CampaignState, form: FormData): Promise<CampaignState> {
  const { user, workspace } = await requireSession();
  const t = await getMessages(campaignsMessages);
  const budget = await money(form, 'budget', t.budget);
  if (typeof budget === 'string') return { error: budget };
  let id: string;
  try {
    const campaign = await createCampaign(getDb(), workspace.id, user.id, {
      name: text(form, 'name'),
      goal: text(form, 'goal') as Goal,
      status: 'draft',
      audience: '',
      message: text(form, 'message'),
      startsOn: text(form, 'startsOn') || null,
      endsOn: text(form, 'endsOn') || null,
      currency: text(form, 'currency') || 'EUR',
      budgetCents: budget,
      channels: [],
      notes: '',
    });
    id = campaign.id;
    await record({ action: 'campaign.created', userId: user.id, workspaceId: workspace.id, target: campaign.name });
  } catch (error) {
    return failure(error);
  }
  refresh();
  redirect(`/campaigns/${id}`);
}

/** Saves the whole plan: goal, audience, message, time, budget and its split across channels. */
export async function saveCampaignAction(campaignId: string, _: CampaignState, form: FormData): Promise<CampaignState> {
  const { user, workspace } = await requireSession();
  const t = await getMessages(campaignsMessages);
  const budget = await money(form, 'budget', t.budget);
  if (typeof budget === 'string') return { error: budget };
  const channels: CampaignInput['channels'] = [];
  for (const channel of form.getAll('channels').map(String)) {
    if (!(CHANNELS as readonly string[]).includes(channel)) continue;
    const cents = await money(form, `budget:${channel}`, t.channelNames[channel as keyof typeof t.channelNames]);
    if (typeof cents === 'string') return { error: cents };
    channels.push({ channel, budgetCents: cents });
  }
  try {
    const campaign = await updateCampaign(getDb(), workspace.id, campaignId, {
      name: text(form, 'name'),
      goal: text(form, 'goal') as Goal,
      status: text(form, 'status') as CampaignStatus,
      audience: text(form, 'audience'),
      message: text(form, 'message'),
      startsOn: text(form, 'startsOn') || null,
      endsOn: text(form, 'endsOn') || null,
      currency: text(form, 'currency'),
      budgetCents: budget,
      channels,
      notes: text(form, 'notes'),
    });
    await record({ action: 'campaign.updated', userId: user.id, workspaceId: workspace.id, target: campaign.name });
  } catch (error) {
    return failure(error);
  }
  refresh(campaignId);
  return { success: t.saved, saved: Date.now() };
}

/** Deletes a campaign with its pieces and results (owners and admins); its posts stay. */
export async function deleteCampaignAction(campaignId: string): Promise<void> {
  const { user, workspace } = await requireAdmin();
  const campaign = await deleteCampaign(getDb(), workspace.id, campaignId);
  if (campaign) await record({ action: 'campaign.deleted', userId: user.id, workspaceId: workspace.id, target: campaign.name });
  refresh();
  redirect('/campaigns');
}

export async function addPieceAction(campaignId: string, _: CampaignState, form: FormData): Promise<CampaignState> {
  const { user, workspace } = await requireSession();
  try {
    const piece = await createPiece(getDb(), workspace.id, campaignId, { kind: text(form, 'kind') as PieceKind, format: text(form, 'format'), title: text(form, 'title') });
    await record({ action: 'piece.created', userId: user.id, workspaceId: workspace.id, target: piece.title });
  } catch (error) {
    return failure(error);
  }
  refresh(campaignId);
  return { saved: Date.now() };
}

/**
 * Moves a piece along its way. Approving (and taking an approval back) is for
 * owners and admins; anyone may mark an approved piece as live or done.
 */
export async function setPieceStatusAction(pieceId: string, status: PieceStatus): Promise<CampaignState> {
  const session = await requireSession();
  const { user, workspace } = session;
  const db = getDb();
  const piece = await getPiece(db, workspace.id, pieceId);
  if (!piece) return {};
  const approving = status === 'approved' || (status === 'draft' && piece.status !== 'draft');
  try {
    if (approving && session.role === 'editor') throw new CampaignError((m) => m.manage);
    const changed = await setPieceStatus(db, workspace.id, pieceId, status, user.id);
    if (status === 'approved' && piece.status === 'draft') await record({ action: 'piece.approved', userId: user.id, workspaceId: workspace.id, target: changed.title });
  } catch (error) {
    return failure(error);
  }
  refresh(piece.campaignId);
  return {};
}

/** Deletes a piece; once approved, only owners and admins may. */
export async function deletePieceAction(pieceId: string): Promise<void> {
  const { user, workspace, role } = await requireSession();
  const db = getDb();
  const existing = await getPiece(db, workspace.id, pieceId);
  if (!existing || (existing.status !== 'draft' && role === 'editor')) return;
  const piece = await deletePiece(db, workspace.id, pieceId);
  if (!piece) return;
  await record({ action: 'piece.deleted', userId: user.id, workspaceId: workspace.id, target: piece.title });
  refresh(piece.campaignId);
}

/** Records what a channel brought on a day (or in a period ending that day). */
export async function addResultAction(campaignId: string, _: CampaignState, form: FormData): Promise<CampaignState> {
  const { user, workspace } = await requireSession();
  const t = await getMessages(campaignsMessages);
  const spend = await money(form, 'spend', t.spend);
  if (typeof spend === 'string') return { error: spend };
  const revenue = await money(form, 'revenue', t.revenue);
  if (typeof revenue === 'string') return { error: revenue };
  // Empty counts are 0; anything else must be a whole number (core says so otherwise).
  const count = (name: string) => {
    const value = text(form, name).replace(/[\s.,']/g, '');
    return value ? Number(value) : 0;
  };
  try {
    await addResult(getDb(), workspace.id, campaignId, user.id, {
      channel: text(form, 'channel'),
      day: text(form, 'day'),
      reach: count('reach'),
      clicks: count('clicks'),
      leads: count('leads'),
      sales: count('sales'),
      revenueCents: revenue,
      spendCents: spend,
      note: text(form, 'note'),
    });
  } catch (error) {
    return failure(error);
  }
  refresh(campaignId);
  return { saved: Date.now() };
}

export async function deleteResultAction(campaignId: string, resultId: string): Promise<void> {
  const { workspace } = await requireSession();
  await deleteResult(getDb(), workspace.id, resultId);
  refresh(campaignId);
}
