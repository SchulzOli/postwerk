import type { PostStatus, TargetStatus } from '@postwerk/db';

export const MAX_ATTEMPTS = 5;

/** Delay before retry number `attempt` (1-based): 1, 2, 4, 8 … minutes, capped at one hour. */
export function backoffMs(attempt: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempt - 1), 60 * 60_000);
}

export function aggregatePostStatus(targets: TargetStatus[]): PostStatus {
  if (targets.length === 0) return 'failed';
  if (targets.some((s) => s === 'pending' || s === 'publishing')) return 'publishing';
  const published = targets.filter((s) => s === 'published').length;
  if (published === targets.length) return 'published';
  return published > 0 ? 'partial' : 'failed';
}
