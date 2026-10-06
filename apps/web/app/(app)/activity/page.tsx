import Link from 'next/link';
import { listWorkspaceAudit } from '@postwerk/core';
import { getDb } from '@postwerk/db';
import { LocalTime } from '@/components/local-time';
import { describeActivity, isWarning } from '@/lib/activity';
import { toActivity } from '@/lib/activity-server';
import { getLocale, getMessages } from '@/lib/i18n-server';
import { requireSession } from '@/lib/session';
import { activityMessages } from '@/messages/activity';
import { commonMessages } from '@/messages/common';

export async function generateMetadata() {
  const [t, common] = await Promise.all([getMessages(activityMessages), getMessages(commonMessages)]);
  return { title: common.title(t.pageTitle) };
}

const PAGE = 50;

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { workspace, role } = await requireSession();
  const locale = await getLocale();
  const t = activityMessages[locale];
  if (role === 'editor') {
    return (
      <div className="card">
        <p className="muted">{t.editorsOnly}</p>
      </div>
    );
  }
  const { before } = await searchParams;
  const beforeDate = before ? new Date(before) : undefined;
  const entries = await listWorkspaceAudit(getDb(), workspace.id, { limit: PAGE, before: beforeDate && !Number.isNaN(beforeDate.getTime()) ? beforeDate : undefined });
  const items = entries.map(toActivity);
  const oldest = items.at(-1)?.createdAt;

  return (
    <div className="stack-lg">
      <div className="row">
        <h1 className="grow">{t.pageTitle}</h1>
        {before && <Link href="/activity" className="button secondary">{t.newest}</Link>}
      </div>
      <div className="card">
        {items.length === 0 ? (
          <p className="muted">{t.nothing(Boolean(before))}</p>
        ) : (
          <ul className="list activity-table">
            {items.map((item) => (
              <li key={item.id} className="row">
                <span className={isWarning(item) ? 'grow activity-warn' : 'grow'}>
                  <span>{describeActivity(item, locale)}</span>
                </span>
                {item.ip && <small className="muted">{item.ip}</small>}
                <small className="muted">
                  <LocalTime iso={item.createdAt} />
                </small>
              </li>
            ))}
          </ul>
        )}
      </div>
      {items.length === PAGE && oldest && (
        <Link href={`/activity?before=${encodeURIComponent(oldest)}`} className="button secondary">
          {t.older}
        </Link>
      )}
    </div>
  );
}
