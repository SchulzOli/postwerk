import 'server-only';
import { listInvites, listMembers } from '@postwerk/core';
import { getDb } from '@postwerk/db';
import type { TeamData } from '@/components/team';
import { appUrl } from './env';
import type { Session } from './session';

/** Members (and, for owners and admins, pending invites) of the session's workspace. */
export async function loadTeam(session: Session): Promise<TeamData> {
  const db = getDb();
  const manage = session.role !== 'editor';
  const [members, invites] = await Promise.all([listMembers(db, session.workspace.id), manage ? listInvites(db, session.workspace.id) : null]);
  return {
    workspace: session.workspace,
    me: { userId: session.user.id, role: session.role },
    members: members.map(({ userId, name, email, role }) => ({ userId, name, email, role })),
    invites:
      invites?.map((invite) => ({
        id: invite.id,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt.toISOString(),
        link: `${appUrl}/invite/${invite.token}`,
      })) ?? null,
  };
}
