import { describe, expect, it } from 'vitest';
import { aggregatePostStatus, backoffMs } from '../src/status';

describe('aggregatePostStatus', () => {
  it.each([
    [['published', 'published'], 'published'],
    [['published', 'pending'], 'publishing'],
    [['publishing'], 'publishing'],
    [['published', 'failed'], 'partial'],
    [['failed', 'failed'], 'failed'],
    [[], 'failed'],
  ] as const)('%j → %s', (targets, expected) => {
    expect(aggregatePostStatus([...targets])).toBe(expected);
  });
});

describe('backoffMs', () => {
  it('doubles and caps at one hour', () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([60_000, 120_000, 240_000, 480_000]);
    expect(backoffMs(20)).toBe(3_600_000);
  });
});
