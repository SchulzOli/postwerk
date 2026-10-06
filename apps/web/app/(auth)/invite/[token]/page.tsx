import Link from 'next/link';
import { findInvite } from '@postwerk/core';
import { getDb } from '@postwerk/db';
import { AcceptInvite } from '@/components/accept-invite';
import { getMessages } from '@/lib/i18n-server';
import { getSession } from '@/lib/session';
import { authMessages } from '@/messages/auth';
import { commonMessages } from '@/messages/common';

export async function generateMetadata() {
  const [t, common] = await Promise.all([getMessages(authMessages), getMessages(commonMessages)]);
  return { title: common.title(t.titles.invite) };
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [invite, session, messages] = await Promise.all([findInvite(getDb(), token), getSession(), getMessages(authMessages)]);
  const t = messages.invite;

  if (!invite || invite.status !== 'valid') {
    return (
      <div className="card stack auth-card">
        <h1>{t.gone}</h1>
        <p className="muted">{invite?.status === 'used' ? t.used : invite ? t.expired : t.invalid} {t.askForNew}</p>
        <Link href={session ? '/canvas' : '/login'}>{session ? t.backToApp : t.logIn}</Link>
      </div>
    );
  }

  const member = session?.workspaces.some((workspace) => workspace.id === invite.workspace.id);
  return (
    <div className="card stack auth-card">
      <h1>{t.join(invite.workspace.name)}</h1>
      <p>
        {t.invitedBefore(invite.inviter)}<strong>{invite.workspace.name}</strong>{t.invitedAfter(invite.role)}
      </p>
      {session ? (
        member ? (
          <>
            <p className="muted">{t.alreadyMember}</p>
            <AcceptInvite token={token} label={t.open(invite.workspace.name)} />
          </>
        ) : (
          <>
            <p className="muted">{t.signedInAs(session.user.email)}</p>
            <AcceptInvite token={token} label={t.join(invite.workspace.name)} />
          </>
        )
      ) : (
        <div className="stack">
          <Link className="button" href={`/signup?invite=${encodeURIComponent(token)}`}>{t.createAccount}</Link>
          <Link className="button secondary" href={`/login?invite=${encodeURIComponent(token)}`}>{t.haveAccount}</Link>
        </div>
      )}
    </div>
  );
}
