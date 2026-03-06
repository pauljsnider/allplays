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

  it('does not drop in-window occurrences for long-running weekly series', () => {
    vi.useFakeTimers();
    const now = new Date('2026-03-01T12:00:00Z');
    vi.setSystemTime(now);
    const windowDays = 30;
    const dayMs = 24 * 60 * 60 * 1000;
    const pastWindowDays = 14;

    const seriesStart = new Date('2024-01-01T17:00:00Z');
    const master = {
      id: 'series-weekly-long-running',
      isSeriesMaster: true,
      date: seriesStart,
      recurrence: {
        freq: 'weekly',
        interval: 1,
        byDays: ['MO']
      }
    };

    const dates = expandRecurrence(master, windowDays).map((occ) => occ.instanceDate);
    const windowStart = new Date(now.getTime() - pastWindowDays * dayMs);
    const windowEnd = new Date(now.getTime() + windowDays * dayMs);
    expect((windowEnd.getTime() - seriesStart.getTime()) / dayMs).toBeGreaterThan(730);

    const firstExpected = new Date(seriesStart);
    while (firstExpected < windowStart) {
      firstExpected.setDate(firstExpected.getDate() + 7);
    }

    const expectedDates = [];
    const cursor = new Date(firstExpected);
    while (cursor <= windowEnd) {
      expectedDates.push(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + 7);
    }

    expect(dates).toEqual(expectedDates);
    expect(dates).toHaveLength(expectedDates.length);
    for (let i = 1; i < dates.length; i++) {
      const previous = new Date(`${dates[i - 1]}T00:00:00Z`);
      const current = new Date(`${dates[i]}T00:00:00Z`);
      expect((current.getTime() - previous.getTime()) / dayMs).toBe(7);
    }
  });

  it('keeps biweekly multi-day cadence anchored to series start after window jump', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));

    const master = {
      id: 'series-weekly-biweekly-long-running',
      isSeriesMaster: true,
      date: new Date('2024-01-03T17:00:00Z'),
      recurrence: {
        freq: 'weekly',
        interval: 2,
        byDays: ['MO', 'WE']
      }
    };

    const dates = expandRecurrence(master, 45).map((occ) => occ.instanceDate);
    expect(dates.slice(0, 6)).toEqual([
      '2026-02-23',
      '2026-02-25',
      '2026-03-09',
      '2026-03-11',
      '2026-03-23',
      '2026-03-25'
    ]);
    expect(dates).not.toContain('2026-02-16');
    expect(dates).not.toContain('2026-02-18');
  });

  it('does not resurface finite weekly series after recurrence count is exhausted before window start', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));

    const master = {
      id: 'series-weekly-finite-exhausted',
      isSeriesMaster: true,
      date: new Date('2024-01-01T17:00:00Z'),
      recurrence: {
        freq: 'weekly',
        interval: 1,
        byDays: ['MO'],
        count: 5
      }
    };

    const dates = expandRecurrence(master, 45).map((occ) => occ.instanceDate);
    expect(dates).toEqual([]);
  });
});
