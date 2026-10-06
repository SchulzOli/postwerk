import 'server-only';
import type { AuditAction } from '@postwerk/core';
import type { AuditEntry } from '@postwerk/db';
import type { ActivityItem } from './activity';

/** Shapes an audit row (with its user) for the activity views. */
export function toActivity(entry: AuditEntry & { user?: { name: string } | null }): ActivityItem {
  return {
    id: entry.id,
    action: entry.action as AuditAction,
    who: entry.user?.name ?? null,
    target: entry.target,
    details: entry.details,
    ip: entry.ip,
    createdAt: entry.createdAt.toISOString(),
  };
}
