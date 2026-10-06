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
import { useMessages } from '@/lib/i18n';
import { commonMessages } from '@/messages/common';
import { teamMessages } from '@/messages/team';
import { RelativeTime } from './relative-time';

export interface TeamData {
  workspace: { id: string; name: string };
  me: { userId: string; role: MemberRole };
  members: { userId: string; name: string; email: string; role: MemberRole }[];
  /** Pending invites with their links; null for editors, who cannot manage them. */
  invites: { id: string; email: string | null; role: MemberRole; expiresAt: string; link: string }[] | null;
}

const roleValues: MemberRole[] = ['editor', 'admin', 'owner'];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const common = useMessages(commonMessages);
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
      {copied ? common.copied : common.copyLink}
    </button>
  );
}

export function TeamPanel({ data }: { data: TeamData }) {
  const { me } = data;
  const t = useMessages(teamMessages);
  const { roles } = useMessages(commonMessages);
  const roleOptions = roleValues.map((value) => ({ value, label: roles[value], hint: t.roleHints[value] }));
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
          <input name="name" aria-label={t.workspaceName} defaultValue={data.workspace.name} maxLength={80} required />
          <button type="submit" className="secondary small" disabled={renaming}>{t.rename}</button>
          {renameState.error && <small className="error">{renameState.error}</small>}
        </form>
      )}

      <section className="stack-sm">
        <h3>{t.members}</h3>
        <ul className="member-list">
          {data.members.map((member) => {
            const self = member.userId === me.userId;
            const canEdit = manage && (me.role === 'owner' || member.role !== 'owner');
            return (
              <li key={member.userId} className="row-tight">
                <span className="avatar-initial" aria-hidden>{member.name.slice(0, 1).toUpperCase()}</span>
                <span className="grow clip">
                  <strong>{member.name}</strong>
                  {self && <span className="muted">{t.you}</span>}
                  <small className="muted clip">{member.email}</small>
                </span>
                {canEdit ? (
                  <select
                    aria-label={t.roleOf(member.name)}
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
                    aria-label={t.remove(member.name)}
                    title={t.removeTitle}
                    disabled={pending}
                    onClick={() => confirm(t.confirmRemove({ name: member.name, workspace: data.workspace.name })) && run(() => removeMemberAction(member.userId))}
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
          <h3>{t.waiting}</h3>
          <ul className="member-list">
            {data.invites.map((pendingInvite) => (
              <li key={pendingInvite.id} className="row-tight">
                <span className="grow clip">
                  {pendingInvite.email ?? t.inviteLink} <span className="muted">· {roleOptions.find((option) => option.value === pendingInvite.role)?.label}</span>
                  <small className="muted clip">
                    {t.expiresBefore}<RelativeTime iso={pendingInvite.expiresAt} />{t.expiresAfter}
                  </small>
                </span>
                <CopyButton text={pendingInvite.link} />
                <button type="button" className="icon-button" aria-label={t.revokeInvite} title={t.revoke} disabled={pending} onClick={() => run(() => revokeInviteAction(pendingInvite.id))}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {manage && (
        <form action={invite} className="stack-sm invite-form">
          <h3>{t.inviteSomeone}</h3>
          <div className="row-tight">
            <input name="email" type="email" placeholder={t.emailOptional} aria-label={t.email} />
            <select name="role" aria-label={t.role} defaultValue="editor">
              {assignable.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <small className="muted">{assignable.map((option) => `${option.label}: ${option.hint}`).join(' · ')}</small>
          <button type="submit" disabled={inviting}>{inviting ? t.creating : t.createInvite}</button>
          {inviteState.error && <p className="error" role="alert">{inviteState.error}</p>}
          {inviteState.success && (
            <div className="stack-sm">
              <p className="success" role="status">{inviteState.success}</p>
              {inviteState.link && (
                <div className="row-tight">
                  <input readOnly value={inviteState.link} aria-label={t.inviteLink} onFocus={(e) => e.target.select()} />
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
        onClick={() => confirm(t.confirmLeave(data.workspace.name)) && run(leaveWorkspaceAction)}
      >
        {t.leave}
      </button>
    </div>
  );
}
