import type { AuditAction } from '@postwerk/core';
import type { Locale } from '@postwerk/core/i18n';
import { catalog, type ProviderId } from '@postwerk/providers/catalog';
import { activityMessages, type ActivityParams } from '@/messages/activity';

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

function network(details: ActivityItem['details']): string | null {
  const provider = details.provider;
  return typeof provider === 'string' && provider in catalog ? catalog[provider as ProviderId].name : null;
}

/** "Anna invited bob@example.com as editor", in the given language. */
export function describeActivity(item: ActivityItem, locale: Locale): string {
  const m = activityMessages[locale];
  const params: ActivityParams = { target: item.target, role: String(item.details.role), network: network(item.details), scheduled: Boolean(item.details.scheduled) };
  // Rows may hold actions this version does not know.
  const phrase = (m.phrases as Partial<typeof m.phrases>)[item.action]?.(params) ?? item.action;
  return `${item.who ?? m.someone} ${phrase}`;
}

/** Events that point at a security problem are highlighted. */
export function isWarning(item: ActivityItem): boolean {
  return item.action === 'login.failed' || item.action === 'login.blocked';
}
