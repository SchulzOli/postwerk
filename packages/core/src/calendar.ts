/**
 * Date math for the calendar, in the viewer's local time (wall clock).
 * Browser-safe: no Node or database imports.
 */

export type CalendarView = 'week' | 'month';

const MINUTES_PER_DAY = 24 * 60;

export function startOfDay(date: Date): Date {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

/** Calendar days, not 24-hour steps, so daylight saving changes keep the time of day. */
export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** The first day of the week `date` is in; `firstDay` 0 is Sunday, 1 is Monday. */
export function startOfWeek(date: Date, firstDay = 1): Date {
  const day = startOfDay(date);
  return addDays(day, -((day.getDay() - firstDay + 7) % 7));
}

/** The days a view shows: one week, or six whole weeks around a month. */
export function visibleDays(view: CalendarView, anchor: Date, firstDay = 1): Date[] {
  const start = view === 'week' ? startOfWeek(anchor, firstDay) : startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1), firstDay);
  return Array.from({ length: view === 'week' ? 7 : 42 }, (_, index) => addDays(start, index));
}

/** [from, to) of a view. */
export function visibleRange(view: CalendarView, anchor: Date, firstDay = 1): { from: Date; to: Date } {
  const days = visibleDays(view, anchor, firstDay);
  return { from: days[0]!, to: addDays(days[days.length - 1]!, 1) };
}

/** The anchor one week or month before (-1) or after (1). */
export function shiftAnchor(view: CalendarView, anchor: Date, by: number): Date {
  if (view === 'week') return addDays(startOfDay(anchor), by * 7);
  return new Date(anchor.getFullYear(), anchor.getMonth() + by, 1);
}

/** "2026-10-06" in local time; identifies a day. */
export function dayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** `day` at a time of day (minutes after midnight). */
export function atMinutes(day: Date, minutes: number): Date {
  const result = startOfDay(day);
  result.setHours(Math.floor(minutes / 60), minutes % 60);
  return result;
}

/** `original`'s time of day on another day. */
export function moveToDay(original: Date, day: Date): Date {
  const result = new Date(day);
  result.setHours(original.getHours(), original.getMinutes(), original.getSeconds(), original.getMilliseconds());
  return result;
}

/** Rounds to a step and keeps the result inside the day. */
export function snapMinutes(minutes: number, step = 15): number {
  return Math.min(MINUTES_PER_DAY - step, Math.max(0, Math.round(minutes / step) * step));
}

/**
 * Side-by-side lanes for items that would overlap in a day column. Each item
 * takes `duration` minutes; items that overlap share the width.
 */
export function layoutDay<T>(items: T[], startOf: (item: T) => number, duration: number): { item: T; lane: number; lanes: number }[] {
  const sorted = [...items].sort((a, b) => startOf(a) - startOf(b));
  const result: { item: T; lane: number; lanes: number }[] = [];
  let group: { item: T; lane: number; lanes: number }[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -Infinity;
  const close = () => {
    for (const entry of group) entry.lanes = laneEnds.length;
    group = [];
    laneEnds = [];
  };
  for (const item of sorted) {
    const start = startOf(item);
    if (start >= groupEnd) {
      close();
      groupEnd = -Infinity;
    }
    let lane = laneEnds.findIndex((end) => end <= start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = start + duration;
    groupEnd = Math.max(groupEnd, start + duration);
    const entry = { item, lane, lanes: 1 };
    group.push(entry);
    result.push(entry);
  }
  close();
  return result;
}

/** The locale's first day of the week (0 Sunday … 6 Saturday); Monday when the browser cannot tell. */
export function firstDayOfWeek(locale?: string): number {
  try {
    const info = new Intl.Locale(locale ?? Intl.DateTimeFormat().resolvedOptions().locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    // Intl reports 1 (Monday) … 7 (Sunday).
    const firstDay = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay;
    return firstDay === undefined ? 1 : firstDay % 7;
  } catch {
    return 1;
  }
}
