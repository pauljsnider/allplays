import { afterEach, describe, expect, it, vi } from 'vitest';
import { expandRecurrence } from '../../js/utils.js';

describe('expandRecurrence interval guardrails', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('honors daily interval in matching and does not double-advance', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-10T12:00:00Z'));

    const master = {
      id: 'series-daily-3',
      isSeriesMaster: true,
      date: new Date('2026-01-01T12:00:00Z'),
      recurrence: {
        freq: 'daily',
        interval: 3
      }
    };

    const dates = expandRecurrence(master, 20).map((occ) => occ.instanceDate);
    expect(dates.slice(0, 6)).toEqual([
      '2026-01-01',
      '2026-01-04',
      '2026-01-07',
      '2026-01-10',
      '2026-01-13',
      '2026-01-16'
    ]);
  });

  it('computes weekly interval from calendar week boundaries for multi-day schedules', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-10T12:00:00Z'));

    const master = {
      id: 'series-weekly-2',
      isSeriesMaster: true,
      date: new Date('2026-01-07T12:00:00Z'),
      recurrence: {
        freq: 'weekly',
        interval: 2,
        byDays: ['MO', 'WE']
      }
    };

    const dates = expandRecurrence(master, 35).map((occ) => occ.instanceDate);
    expect(dates.slice(0, 5)).toEqual([
      '2026-01-07',
      '2026-01-19',
      '2026-01-21',
      '2026-02-02',
      '2026-02-04'
    ]);
  });

  it('skips off-cadence weekdays in the immediate next week for biweekly multi-day rules', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-05T12:00:00Z'));

    const master = {
      id: 'series-weekly-2-wed-mo',
      isSeriesMaster: true,
      date: new Date('2026-03-04T12:00:00Z'),
      recurrence: {
        freq: 'weekly',
        interval: 2,
        byDays: ['MO', 'WE']
      }
    };

    const dates = expandRecurrence(master, 35).map((occ) => occ.instanceDate);
    expect(dates.slice(0, 5)).toEqual([
      '2026-03-04',
      '2026-03-16',
      '2026-03-18',
      '2026-03-30',
      '2026-04-01'
    ]);
    expect(dates).not.toContain('2026-03-09');
  });
});
