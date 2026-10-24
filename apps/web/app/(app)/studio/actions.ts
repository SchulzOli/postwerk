'use server';

import { revalidatePath } from 'next/cache';
import { CampaignError, hitRateLimit, limits, rateLimitKey, retryIn } from '@maas/core';
import { runStudio, StudioError } from '@maas/core/studio';
import { getDb } from '@maas/db';
import { record } from '@/lib/audit';
import { getLocale, getMessages, localizedError } from '@/lib/i18n-server';
import { requireSession } from '@/lib/session';
import { studioMessages } from '@/messages/studio';

export type StudioState = { error?: string; success?: string; saved?: number };

/** Has Claude draft the chosen formats into a campaign (any member; the drafts need an approval like any piece). */
export async function runStudioAction(_: StudioState, form: FormData): Promise<StudioState> {
  const { user, workspace } = await requireSession();
  const t = await getMessages(studioMessages);
  const db = getDb();
  const limit = await hitRateLimit(db, rateLimitKey('studio:workspace', workspace.id), limits.studio);
  if (!limit.allowed) return { error: t.tooOften(retryIn(limit.retryAfterMs, await getLocale())) };
  const text = (name: string) => String(form.get(name) ?? '');
  let run;
  try {
    run = await runStudio(db, workspace, user.id, {
      campaignId: text('campaign'),
      formats: form.getAll('formats').map(String),
      variants: Number(text('variants')),
      language: text('language'),
      notes: text('notes'),
    });
  } catch (error) {
    if (error instanceof StudioError || error instanceof CampaignError) return { error: await localizedError(error) };
    throw error;
  }
  const campaign = await db.query.campaigns.findFirst({ where: (c, { and, eq }) => and(eq(c.id, run.campaignId), eq(c.workspaceId, workspace.id)), columns: { name: true } });
  await record({ action: 'studio.drafted', userId: user.id, workspaceId: workspace.id, target: campaign?.name ?? null });
  revalidatePath('/studio');
  revalidatePath(`/campaigns/${run.campaignId}`);
  revalidatePath('/campaigns');
  if (run.pieceIds.length + run.postIdeas.length === 0) return { error: t.nothing };
  return { success: t.done(run.pieceIds.length, run.postIdeas.length), saved: Date.now() };
}
