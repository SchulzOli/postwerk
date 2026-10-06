import 'server-only';
import { listPostsBetween } from '@postwerk/core';
import { getDb } from '@postwerk/db';
import type { CalendarData } from './calendar';

const LIMIT = 500;
const DAY = 24 * 60 * 60_000;

/** The calendar's posts between two instants, at most LIMIT of them. */
export async function loadCalendar(workspaceId: string, from: Date, to: Date): Promise<CalendarData> {
  const posts = await listPostsBetween(getDb(), workspaceId, from, to, LIMIT + 1);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    truncated: posts.length > LIMIT,
    posts: posts.slice(0, LIMIT).map((post) => ({
      id: post.id,
      text: post.text,
      status: post.status,
      scheduledAt: post.scheduledAt!.toISOString(),
      thumb: post.media[0] ? { url: post.media[0].url, kind: post.media[0].kind } : null,
      targets: post.targets.map((target) => ({ accountId: target.socialAccountId, provider: target.account.provider, handle: target.account.handle, status: target.status })),
    })),
  };
}

/** Enough weeks around today that the first views (this and next month) need no extra request. */
export function loadCalendarAroundNow(workspaceId: string): Promise<CalendarData> {
  const now = Date.now();
  return loadCalendar(workspaceId, new Date(now - 42 * DAY), new Date(now + 84 * DAY));
}

/** Longest range a client may ask for: six weeks plus time zone slack. */
export const MAX_CALENDAR_SPAN = 44 * DAY;
