import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, atMinutes, dayKey, layoutDay, minutesOfDay, moveToDay, shiftAnchor, snapMinutes, startOfWeek, visibleDays, visibleRange } from '../src/calendar';

// Local-time math; Berlin has daylight saving (clocks go back on 2026-10-25).
const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'Europe/Berlin';
});
afterAll(() => {
  process.env.TZ = originalTz;
});

const local = (text: string) => new Date(text); // "YYYY-MM-DDTHH:mm" without zone is local time

describe('calendar', () => {
  it('starts weeks on the chosen day', () => {
    const tuesday = local('2026-10-06T15:00');
    expect(dayKey(startOfWeek(tuesday, 1))).toBe('2026-10-05');
    expect(dayKey(startOfWeek(tuesday, 0))).toBe('2026-10-04');
    expect(dayKey(startOfWeek(local('2026-10-04T10:00'), 1))).toBe('2026-09-28');
  });

  it('shows six whole weeks for a month', () => {
    const days = visibleDays('month', local('2026-10-17T12:00'), 1);
    expect(days).toHaveLength(42);
    expect(dayKey(days[0]!)).toBe('2026-09-28');
    expect(dayKey(days[41]!)).toBe('2026-11-08');
    const { from, to } = visibleRange('month', local('2026-10-17T12:00'), 1);
    expect([from.getTime(), to.getTime()]).toEqual([local('2026-09-28T00:00').getTime(), local('2026-11-09T00:00').getTime()]);
  });

  it('steps through weeks and months', () => {
    expect(dayKey(shiftAnchor('week', local('2026-10-06T15:00'), 1))).toBe('2026-10-13');
    expect(dayKey(shiftAnchor('month', local('2026-01-31T15:00'), 1))).toBe('2026-02-01');
    expect(dayKey(shiftAnchor('month', local('2026-01-15T15:00'), -1))).toBe('2025-12-01');
  });

  it('keeps the time of day across daylight saving changes', () => {
    const before = local('2026-10-24T09:30');
    const moved = moveToDay(before, local('2026-10-26T00:00'));
    expect([dayKey(moved), minutesOfDay(moved)]).toEqual(['2026-10-26', 9 * 60 + 30]);
    // 25 hours apart in real time, but one calendar day.
    expect(addDays(before, 1).getTime() - before.getTime()).toBe(25 * 3600_000);
    expect(minutesOfDay(atMinutes(local('2026-10-25T00:00'), 14 * 60 + 15))).toBe(14 * 60 + 15);
  });

  it('snaps to a grid inside the day', () => {
    expect([snapMinutes(7), snapMinutes(8), snapMinutes(-30), snapMinutes(1439), snapMinutes(100, 30)]).toEqual([0, 15, 0, 1425, 90]);
  });

  it('puts overlapping items side by side', () => {
    const lanes = layoutDay([600, 0, 620, 660, 700, 1000], (start) => start, 60).map(({ item, lane, lanes }) => [item, lane, lanes]);
    expect(lanes).toEqual([
      [0, 0, 1],
      [600, 0, 2],
      [620, 1, 2],
      [660, 0, 2],
      [700, 1, 2],
      [1000, 0, 1],
    ]);
  });
});
