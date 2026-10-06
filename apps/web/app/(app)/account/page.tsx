import { isMailConfigured, listUserSecurityAudit } from '@postwerk/core';
import { getDb } from '@postwerk/db';
import { AccountForms } from '@/components/account-forms';
import { LocalTime } from '@/components/local-time';
import { requireSession } from '@/lib/session';

export const metadata = { title: 'Account · Postwerk' };

const securityLabels: Record<string, string> = {
  'login.succeeded': 'Signed in',
  'login.failed': 'Failed sign-in',
  'login.blocked': 'Blocked after too many failed sign-ins',
  'password.changed': 'Password changed',
  'password.reset_requested': 'Password reset link requested',
  'password.reset': 'Password reset',
  'email.verified': 'Email address confirmed',
  'user.signed_up': 'Account created',
};

export default async function AccountPage() {
  const { user } = await requireSession();
  const events = await listUserSecurityAudit(getDb(), user.id, 15);
  return (
    <div className="stack-lg">
      <h1>Account</h1>
      <AccountForms
        user={{ name: user.name, email: user.email, verified: Boolean(user.emailVerifiedAt), notifyFailures: user.notifyFailures }}
        mailConfigured={isMailConfigured()}
      />
      <section className="card stack">
        <h2>Recent sign-ins</h2>
        <ul className="list">
          {events.map((event) => (
            <li key={event.id} className="row">
              <span className={event.action === 'login.failed' || event.action === 'login.blocked' ? 'grow activity-warn' : 'grow'}>
                <span>{securityLabels[event.action] ?? event.action}</span>
              </span>
              {event.ip && <small className="muted">{event.ip}</small>}
              <small className="muted">
                <LocalTime iso={event.createdAt.toISOString()} />
              </small>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
