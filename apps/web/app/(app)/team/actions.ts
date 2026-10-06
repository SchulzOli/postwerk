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
import { requireSession } from '@/lib/session';

export type TeamState = { error?: string; success?: string; link?: string };

const actorOf = (session: Awaited<ReturnType<typeof requireSession>>) => ({ userId: session.user.id, role: session.role });
const isRole = (value: string): value is MemberRole => (roles as string[]).includes(value);

/** Runs a team change; rule violations come back as a message instead of an error page. */
async function attempt<T>(run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    if (error instanceof PermissionError) return { ok: false, error: error.message };
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
  return { success: 'Saved.' };
}

export async function inviteAction(_: TeamState, form: FormData): Promise<TeamState> {
  const session = await requireSession();
  const role = String(form.get('role') ?? 'editor');
  if (!isRole(role)) return { error: 'Choose a role.' };
  const email = String(form.get('email') ?? '').trim();
  const result = await attempt(() => createInvite(getDb(), { workspaceId: session.workspace.id, actor: actorOf(session), email, role }));
  if (!result.ok) return { error: result.error };
  await record({ action: 'member.invited', userId: session.user.id, workspaceId: session.workspace.id, target: email || 'an invite link', details: { role } });
  refresh();
  const link = `${appUrl}/invite/${result.value.token}`;
  if (email && isMailConfigured()) {
    try {
      await sendMail(inviteMail(email, { inviter: session.user.name, workspace: session.workspace.name, role: role === 'editor' ? 'an editor' : `an ${role}`, url: link }));
      return { success: `We emailed the invite to ${email}. You can also share the link yourself:`, link };
    } catch (error) {
      console.error('invite email failed', error);
      return { success: `The email to ${email} could not be sent. Share this link with them instead:`, link };
    }
  }
  return { success: email ? `Invite for ${email} created. Send them this link:` : 'Invite link created. Anyone with it can join once:', link };
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
  if (!isRole(role)) return { error: 'Choose a role.' };
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
