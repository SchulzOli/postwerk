import Link from 'next/link';
import { findInvite } from '@postwerk/core';
import { getDb } from '@postwerk/db';
import { AcceptInvite } from '@/components/accept-invite';
import { getSession } from '@/lib/session';

export const metadata = { title: 'Invitation · Postwerk' };

const roleNames = { owner: 'an owner', admin: 'an admin', editor: 'an editor' };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [invite, session] = await Promise.all([findInvite(getDb(), token), getSession()]);

  if (!invite || invite.status !== 'valid') {
    return (
      <div className="card stack auth-card">
        <h1>This invite does not work anymore</h1>
        <p className="muted">{invite?.status === 'used' ? 'It was already used.' : invite ? 'It has expired.' : 'The link is not valid.'} Ask the person who invited you for a new one.</p>
        <Link href={session ? '/canvas' : '/login'}>{session ? 'Back to Postwerk' : 'Log in'}</Link>
      </div>
    );
  }

  const member = session?.workspaces.some((workspace) => workspace.id === invite.workspace.id);
  return (
    <div className="card stack auth-card">
      <h1>Join {invite.workspace.name}</h1>
      <p>
        {invite.inviter ? `${invite.inviter} invited you` : 'You are invited'} to work in <strong>{invite.workspace.name}</strong> as {roleNames[invite.role]}.
      </p>
      {session ? (
        member ? (
          <>
            <p className="muted">You are already a member.</p>
            <AcceptInvite token={token} label={`Open ${invite.workspace.name}`} />
          </>
        ) : (
          <>
            <p className="muted">You are signed in as {session.user.email}.</p>
            <AcceptInvite token={token} label={`Join ${invite.workspace.name}`} />
          </>
        )
      ) : (
        <div className="stack">
          <Link className="button" href={`/signup?invite=${encodeURIComponent(token)}`}>Create an account</Link>
          <Link className="button secondary" href={`/login?invite=${encodeURIComponent(token)}`}>I already have an account</Link>
        </div>
      )}
    </div>
  );
}
