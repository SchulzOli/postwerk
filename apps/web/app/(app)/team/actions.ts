'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  acceptInvite,
  changeMemberRole,
  createInvite,
  createWorkspace,
  inviteMail,
  isMailConfigured,
  listMembers,
  PermissionError,
  removeMember,
  renameWorkspace,
  revokeInvite,
  roles,
  sendMail,
  switchSessionWorkspace,
} from '@postwerk/core';
import { getDb, type MemberRole } from '@postwerk/db';
import { record } from '@/lib/audit';
import { appUrl } from '@/lib/env';
import { getLocale, getMessages, localizedError } from '@/lib/i18n-server';
import { requireSession } from '@/lib/session';
import { teamMessages } from '@/messages/team';

export type TeamState = { error?: string; success?: string; link?: string };

const actorOf = (session: Awaited<ReturnType<typeof requireSession>>) => ({ userId: session.user.id, role: session.role });
const isRole = (value: string): value is MemberRole => (roles as string[]).includes(value);

/** Runs a team change; rule violations come back as a message instead of an error page. */
async function attempt<T>(run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    if (error instanceof PermissionError) return { ok: false, error: await localizedError(error) };
    throw error;
  }
}

function refresh() {
  revalidatePath('/', 'layout');
}

export async function switchWorkspaceAction(workspaceId: string) {
  const session = await requireSession();
  if (await switchSessionWorkspace(getDb(), session.sessionId, session.user.id, workspaceId)) refresh();
  redirect('/canvas');
}

export async function createWorkspaceAction(_: TeamState, form: FormData): Promise<TeamState> {
  const session = await requireSession();
  const db = getDb();
  const result = await attempt(() => createWorkspace(db, session.user.id, String(form.get('name') ?? '')));
  if (!result.ok) return { error: result.error };
  await record({ action: 'workspace.created', userId: session.user.id, workspaceId: result.value.id, target: result.value.name });
  await switchSessionWorkspace(db, session.sessionId, session.user.id, result.value.id);
  refresh();
  redirect('/canvas#n=region:networks');
}

export async function renameWorkspaceAction(_: TeamState, form: FormData): Promise<TeamState> {
  const session = await requireSession();
  const result = await attempt(() => renameWorkspace(getDb(), session.workspace.id, actorOf(session), String(form.get('name') ?? '')));
  if (!result.ok) return { error: result.error };
  await record({ action: 'workspace.renamed', userId: session.user.id, workspaceId: session.workspace.id, target: result.value });
  refresh();
  return { success: (await getMessages(teamMessages)).saved };
}

export async function inviteAction(_: TeamState, form: FormData): Promise<TeamState> {
  const session = await requireSession();
  const locale = await getLocale();
  const t = teamMessages[locale];
  const role = String(form.get('role') ?? 'editor');
  if (!isRole(role)) return { error: t.chooseRole };
  const email = String(form.get('email') ?? '').trim();
  const result = await attempt(() => createInvite(getDb(), { workspaceId: session.workspace.id, actor: actorOf(session), email, role }));
  if (!result.ok) return { error: result.error };
  await record({ action: 'member.invited', userId: session.user.id, workspaceId: session.workspace.id, target: email || 'an invite link', details: { role } });
  refresh();
  const link = `${appUrl}/invite/${result.value.token}`;
  if (email && isMailConfigured()) {
    try {
      // In the inviter's language: we do not know the invitee's yet.
      await sendMail(inviteMail(email, { inviter: session.user.name, workspace: session.workspace.name, role, url: link }, locale));
      return { success: t.invitedByEmail(email), link };
    } catch (error) {
      console.error('invite email failed', error);
      return { success: t.emailFailed(email), link };
    }
  }
  return { success: email ? t.inviteCreated(email) : t.linkCreated, link };
}

export async function revokeInviteAction(inviteId: string): Promise<{ error?: string }> {
  const session = await requireSession();
  const result = await attempt(() => revokeInvite(getDb(), session.workspace.id, actorOf(session), inviteId));
  if (!result.ok) return { error: result.error };
  if (result.value) {
    await record({ action: 'invite.revoked', userId: session.user.id, workspaceId: session.workspace.id, target: result.value.email ?? 'an invite link' });
  }
  refresh();
  return {};
}

async function memberName(workspaceId: string, userId: string) {
  return (await listMembers(getDb(), workspaceId)).find((member) => member.userId === userId)?.name ?? 'a member';
}

export async function changeRoleAction(userId: string, role: string): Promise<{ error?: string }> {
  const session = await requireSession();
  if (!isRole(role)) return { error: (await getMessages(teamMessages)).chooseRole };
  const name = await memberName(session.workspace.id, userId);
  const result = await attempt(() => changeMemberRole(getDb(), session.workspace.id, actorOf(session), userId, role));
  if (!result.ok) return { error: result.error };
  await record({ action: 'member.role_changed', userId: session.user.id, workspaceId: session.workspace.id, target: name, details: { role, previous: result.value.previous } });
  refresh();
  return {};
}

export async function removeMemberAction(userId: string): Promise<{ error?: string }> {
  const session = await requireSession();
  const name = await memberName(session.workspace.id, userId);
  const result = await attempt(() => removeMember(getDb(), session.workspace.id, actorOf(session), userId));
  if (!result.ok) return { error: result.error };
  await record({ action: 'member.removed', userId: session.user.id, workspaceId: session.workspace.id, target: name });
  refresh();
  return {};
}

export async function leaveWorkspaceAction(): Promise<{ error?: string }> {
  const session = await requireSession();
  const result = await attempt(() => removeMember(getDb(), session.workspace.id, actorOf(session), session.user.id));
  if (!result.ok) return { error: result.error };
  await record({ action: 'member.left', userId: session.user.id, workspaceId: session.workspace.id });
  refresh();
  redirect('/canvas');
}

/** Joins the workspace of an invite link as the signed-in user. */
export async function acceptInviteAction(token: string): Promise<{ error?: string }> {
  const session = await requireSession();
  const db = getDb();
  const result = await attempt(() => acceptInvite(db, token, session.user.id));
  if (!result.ok) return { error: result.error };
  if (result.value.joined) {
    await record({ action: 'member.joined', userId: session.user.id, workspaceId: result.value.workspaceId, details: { role: result.value.role } });
  }
  await switchSessionWorkspace(db, session.sessionId, session.user.id, result.value.workspaceId);
  refresh();
  redirect('/canvas');
}
