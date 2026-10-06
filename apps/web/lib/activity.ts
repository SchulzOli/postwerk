import type { AuditAction } from '@postwerk/core';
import { catalog, type ProviderId } from '@postwerk/providers/catalog';

export interface ActivityItem {
  id: string;
  action: AuditAction;
  /** Name of who did it; null when the user was deleted or unknown (failed sign-ins). */
  who: string | null;
  target: string | null;
  details: Record<string, string | number | boolean | null>;
  ip: string | null;
  createdAt: string;
}

const roleLabels: Record<string, string> = { owner: 'owner', admin: 'admin', editor: 'editor' };

function network(details: ActivityItem['details']): string {
  const provider = details.provider;
  return typeof provider === 'string' && provider in catalog ? ` on ${catalog[provider as ProviderId].name}` : '';
}

/** What happened, as the rest of a sentence that starts with who did it. */
const phrases: Record<AuditAction, (item: ActivityItem) => string> = {
  'user.signed_up': () => 'signed up',
  'login.succeeded': () => 'signed in',
  'login.failed': (item) => `failed to sign in${item.target ? ` as ${item.target}` : ''}`,
  'login.blocked': (item) => `was blocked after too many failed sign-ins${item.target ? ` as ${item.target}` : ''}`,
  'password.changed': () => 'changed their password',
  'password.reset_requested': () => 'asked for a password reset link',
  'password.reset': () => 'reset their password',
  'email.verified': () => 'verified their email address',
  'workspace.created': (item) => `created the workspace “${item.target}”`,
  'workspace.renamed': (item) => `renamed the workspace to “${item.target}”`,
  'member.invited': (item) => `invited ${item.target ?? 'someone'} as ${roleLabels[String(item.details.role)] ?? 'member'}`,
  'invite.revoked': (item) => `revoked the invite for ${item.target ?? 'a link'}`,
  'member.joined': (item) => `joined as ${roleLabels[String(item.details.role)] ?? 'member'}`,
  'member.role_changed': (item) => `made ${item.target} ${roleLabels[String(item.details.role)] ?? 'a member'}`,
  'member.removed': (item) => `removed ${item.target} from the workspace`,
  'member.left': () => 'left the workspace',
  'account.connected': (item) => `connected ${item.target}${network(item.details)}`,
  'account.disconnected': (item) => `disconnected ${item.target}${network(item.details)}`,
  'flow.created': (item) => `created the flow “${item.target}”`,
  'flow.deleted': (item) => `deleted the flow “${item.target}”`,
  'post.created': (item) => `${item.details.scheduled ? 'scheduled' : 'published'} “${item.target}”`,
  'post.updated': (item) => `edited “${item.target}”`,
  'post.deleted': (item) => `deleted “${item.target}”`,
  'post.retried': (item) => `retried “${item.target}”`,
  'plugin.installed': (item) => `installed the ${item.target} theme`,
  'plugin.uninstalled': (item) => `uninstalled the ${item.target} theme`,
};

export function describeActivity(item: ActivityItem): string {
  const phrase = phrases[item.action]?.(item) ?? item.action;
  return `${item.who ?? 'Someone'} ${phrase}`;
}

/** Events that point at a security problem are highlighted. */
export function isWarning(item: ActivityItem): boolean {
  return item.action === 'login.failed' || item.action === 'login.blocked';
}
