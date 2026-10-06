'use client';

import { useActionState, useState, useTransition } from 'react';
import type { MemberRole } from '@postwerk/db/types';
import {
  changeRoleAction,
  inviteAction,
  leaveWorkspaceAction,
  removeMemberAction,
  renameWorkspaceAction,
  revokeInviteAction,
} from '@/app/(app)/team/actions';
import { RelativeTime } from './relative-time';

export interface TeamData {
  workspace: { id: string; name: string };
  me: { userId: string; role: MemberRole };
  members: { userId: string; name: string; email: string; role: MemberRole }[];
  /** Pending invites with their links; null for editors, who cannot manage them. */
  invites: { id: string; email: string | null; role: MemberRole; expiresAt: string; link: string }[] | null;
}

const roleOptions: { value: MemberRole; label: string; hint: string }[] = [
  { value: 'editor', label: 'Editor', hint: 'writes and schedules posts, builds flows' },
  { value: 'admin', label: 'Admin', hint: 'also connects accounts, installs themes, manages people' },
  { value: 'owner', label: 'Owner', hint: 'everything, including other owners' },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="secondary small"
      onClick={async () => {
        await navigator.clipboard?.writeText(text).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? 'Copied' : 'Copy link'}
    </button>
  );
}

export function TeamPanel({ data }: { data: TeamData }) {
  const { me } = data;
  const manage = me.role !== 'editor';
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [renameState, renameAction, renaming] = useActionState(renameWorkspaceAction, {});
  const [inviteState, invite, inviting] = useActionState(inviteAction, {});
  // Admins cannot hand out or touch the owner role.
  const assignable = roleOptions.filter((option) => me.role === 'owner' || option.value !== 'owner');
  const run = (action: () => Promise<{ error?: string }>) => startTransition(async () => setError((await action()).error));

  return (
    <div className="stack team">
      {manage && (
        <form action={renameAction} className="row-tight">
          <input name="name" aria-label="Workspace name" defaultValue={data.workspace.name} maxLength={80} required />
          <button type="submit" className="secondary small" disabled={renaming}>Rename</button>
          {renameState.error && <small className="error">{renameState.error}</small>}
        </form>
      )}

      <section className="stack-sm">
        <h3>Members</h3>
        <ul className="member-list">
          {data.members.map((member) => {
            const self = member.userId === me.userId;
            const canEdit = manage && (me.role === 'owner' || member.role !== 'owner');
            return (
              <li key={member.userId} className="row-tight">
                <span className="avatar-initial" aria-hidden>{member.name.slice(0, 1).toUpperCase()}</span>
                <span className="grow clip">
                  <strong>{member.name}</strong>
                  {self && <span className="muted"> (you)</span>}
                  <small className="muted clip">{member.email}</small>
                </span>
                {canEdit ? (
                  <select
                    aria-label={`Role of ${member.name}`}
                    value={member.role}
                    disabled={pending}
                    onChange={(e) => run(() => changeRoleAction(member.userId, e.target.value))}
                  >
                    {(member.role === 'owner' ? roleOptions : assignable).map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                ) : (
                  <span className="badge">{roleOptions.find((option) => option.value === member.role)?.label}</span>
                )}
                {canEdit && !self && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove ${member.name}`}
                    title="Remove from workspace"
                    disabled={pending}
                    onClick={() => confirm(`Remove ${member.name} from ${data.workspace.name}?`) && run(() => removeMemberAction(member.userId))}
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {data.invites && data.invites.length > 0 && (
        <section className="stack-sm">
          <h3>Waiting to join</h3>
          <ul className="member-list">
            {data.invites.map((pendingInvite) => (
              <li key={pendingInvite.id} className="row-tight">
                <span className="grow clip">
                  {pendingInvite.email ?? 'Invite link'} <span className="muted">· {roleOptions.find((option) => option.value === pendingInvite.role)?.label}</span>
                  <small className="muted clip">
                    expires <RelativeTime iso={pendingInvite.expiresAt} />
                  </small>
                </span>
                <CopyButton text={pendingInvite.link} />
                <button type="button" className="icon-button" aria-label="Revoke invite" title="Revoke" disabled={pending} onClick={() => run(() => revokeInviteAction(pendingInvite.id))}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {manage && (
        <form action={invite} className="stack-sm invite-form">
          <h3>Invite someone</h3>
          <div className="row-tight">
            <input name="email" type="email" placeholder="Email (optional)" aria-label="Email" />
            <select name="role" aria-label="Role" defaultValue="editor">
              {assignable.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <small className="muted">{assignable.map((option) => `${option.label}: ${option.hint}`).join(' · ')}</small>
          <button type="submit" disabled={inviting}>{inviting ? 'Creating…' : 'Create invite link'}</button>
          {inviteState.error && <p className="error" role="alert">{inviteState.error}</p>}
          {inviteState.success && (
            <div className="stack-sm">
              <p className="success" role="status">{inviteState.success}</p>
              {inviteState.link && (
                <div className="row-tight">
                  <input readOnly value={inviteState.link} aria-label="Invite link" onFocus={(e) => e.target.select()} />
                  <CopyButton text={inviteState.link} />
                </div>
              )}
            </div>
          )}
        </form>
      )}

      {error && <p className="error" role="alert">{error}</p>}
      <button
        type="button"
        className="link leave"
        disabled={pending}
        onClick={() => confirm(`Leave ${data.workspace.name}? You need a new invite to come back.`) && run(leaveWorkspaceAction)}
      >
        Leave this workspace
      </button>
    </div>
  );
}
