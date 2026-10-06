import { and, desc, eq, isNotNull, isNull, lt } from 'drizzle-orm';
import { auditLog, type Database } from '@postwerk/db';

/** Everything we record. Workspace-less events (sign-ins, password changes) concern only the user. */
export type AuditAction =
  | 'user.signed_up'
  | 'login.succeeded'
  | 'login.failed'
  | 'login.blocked'
  | 'password.changed'
  | 'password.reset_requested'
  | 'password.reset'
  | 'email.verified'
  | 'workspace.created'
  | 'workspace.renamed'
  | 'member.invited'
  | 'invite.revoked'
  | 'member.joined'
  | 'member.role_changed'
  | 'member.removed'
  | 'member.left'
  | 'account.connected'
  | 'account.disconnected'
  | 'flow.created'
  | 'flow.deleted'
  | 'post.created'
  | 'post.updated'
  | 'post.deleted'
  | 'post.retried'
  | 'plugin.installed'
  | 'plugin.uninstalled';

export interface AuditInput {
  action: AuditAction;
  workspaceId?: string | null;
  userId?: string | null;
  target?: string | null;
  details?: Record<string, string | number | boolean | null>;
  ip?: string | null;
}

/** Records an event. Never throws: losing an audit row must not break what the user was doing. */
export async function audit(db: Pick<Database, 'insert'>, entry: AuditInput): Promise<void> {
  try {
    await db.insert(auditLog).values({
      action: entry.action,
      workspaceId: entry.workspaceId ?? null,
      userId: entry.userId ?? null,
      target: entry.target?.slice(0, 300) ?? null,
      details: entry.details ?? {},
      ip: entry.ip?.slice(0, 100) ?? null,
    });
  } catch (error) {
    console.error('audit log write failed', entry.action, error);
  }
}

/** How long the activity log keeps IP addresses (the events themselves stay). The privacy page names this. */
export const AUDIT_IP_DAYS = 90;

/** Housekeeping: removes IP addresses from events older than AUDIT_IP_DAYS. */
export async function forgetOldAuditIps(db: Database, now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - AUDIT_IP_DAYS * 24 * 60 * 60_000);
  await db.update(auditLog).set({ ip: null }).where(and(isNotNull(auditLog.ip), lt(auditLog.createdAt, cutoff)));
}

/** A workspace's events, newest first; pass the oldest `createdAt` you have as `before` for the next page. */
export async function listWorkspaceAudit(db: Database, workspaceId: string, options: { limit?: number; before?: Date } = {}) {
  return db.query.auditLog.findMany({
    where: and(eq(auditLog.workspaceId, workspaceId), options.before ? lt(auditLog.createdAt, options.before) : undefined),
    orderBy: [desc(auditLog.createdAt)],
    limit: Math.min(options.limit ?? 50, 200),
    with: { user: { columns: { name: true, email: true } } },
  });
}

/** A user's own security events (sign-ins, password changes), newest first. */
export async function listUserSecurityAudit(db: Database, userId: string, limit = 20) {
  return db.query.auditLog.findMany({
    where: and(eq(auditLog.userId, userId), isNull(auditLog.workspaceId)),
    orderBy: [desc(auditLog.createdAt)],
    limit,
  });
}
