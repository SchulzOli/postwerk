import { isMailConfigured, listUserSecurityAudit } from '@postwerk/core';
import { isLocale } from '@postwerk/core/i18n';
import { getDb } from '@postwerk/db';
import { AccountForms } from '@/components/account-forms';
import { LocalTime } from '@/components/local-time';
import { getMessages } from '@/lib/i18n-server';
import { requireSession } from '@/lib/session';
import { accountMessages } from '@/messages/account';
import { commonMessages } from '@/messages/common';

export async function generateMetadata() {
  const [t, common] = await Promise.all([getMessages(accountMessages), getMessages(commonMessages)]);
  return { title: common.title(t.pageTitle) };
}

export default async function AccountPage() {
  const { user } = await requireSession();
  const [events, t] = await Promise.all([listUserSecurityAudit(getDb(), user.id, 15), getMessages(accountMessages)]);
  const securityLabels: Record<string, string> = t.security;
  return (
    <div className="stack-lg">
      <h1>{t.pageTitle}</h1>
      <AccountForms
        user={{ name: user.name, email: user.email, verified: Boolean(user.emailVerifiedAt), notifyFailures: user.notifyFailures, locale: isLocale(user.locale) ? user.locale : null }}
        mailConfigured={isMailConfigured()}
      />
      <section className="card stack">
        <h2>{t.recentSignIns}</h2>
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
