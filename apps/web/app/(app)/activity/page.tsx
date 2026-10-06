import Link from 'next/link';
import { listWorkspaceAudit } from '@postwerk/core';
import { getDb } from '@postwerk/db';
import { LocalTime } from '@/components/local-time';
import { describeActivity, isWarning } from '@/lib/activity';
import { toActivity } from '@/lib/activity-server';
import { requireSession } from '@/lib/session';

export const metadata = { title: 'Activity · Postwerk' };

const PAGE = 50;

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { workspace, role } = await requireSession();
  if (role === 'editor') {
    return (
      <div className="card">
        <p className="muted">Only workspace owners and admins can see the activity log.</p>
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
        <h1 className="grow">Activity</h1>
        {before && <Link href="/activity" className="button secondary">Newest</Link>}
      </div>
      <div className="card">
        {items.length === 0 ? (
          <p className="muted">Nothing {before ? 'older' : 'yet'}.</p>
        ) : (
          <ul className="list activity-table">
            {items.map((item) => (
              <li key={item.id} className="row">
                <span className={isWarning(item) ? 'grow activity-warn' : 'grow'}>
                  <span>{describeActivity(item)}</span>
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
          Older
        </Link>
      )}
    </div>
  );
}
