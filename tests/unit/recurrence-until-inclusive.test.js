import { describe, it, expect, vi, afterEach } from 'vitest';
import { expandRecurrence } from '../../js/utils.js';

const originalTz = process.env.TZ;

afterEach(() => {
    vi.useRealTimers();
    process.env.TZ = originalTz;
});

describe('expandRecurrence until end date inclusivity', () => {
    it('includes occurrences on the until calendar date for non-midnight start times', () => {
        process.env.TZ = 'UTC';
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-01T12:00:00'));

        const master = {
            id: 'series-1',
            isSeriesMaster: true,
            date: new Date('2026-03-01T18:00:00'),
            startTime: '18:00',
            endTime: '19:00',
            recurrence: {
                freq: 'daily',
                interval: 1,
                until: new Date('2026-03-03')
            }
        };

        const occurrences = expandRecurrence(master, 30);
        const dates = occurrences.map((occurrence) => occurrence.instanceDate);

        expect(dates).toEqual(['2026-03-01', '2026-03-02', '2026-03-03']);
    });

    it('includes the final local day when until came from UTC date-only parsing', () => {
        process.env.TZ = 'America/Chicago';
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-01T12:00:00-06:00'));

        const master = {
            id: 'series-utc-date-only',
            isSeriesMaster: true,
            date: new Date('2026-03-01T18:00:00-06:00'),
            startTime: '18:00',
            endTime: '19:00',
            recurrence: {
                freq: 'daily',
                interval: 1,
                until: {
                    toDate: () => new Date('2026-03-03')
                }
            }
        };

        const occurrences = expandRecurrence(master, 30);
        const dates = occurrences.map((occurrence) => occurrence.instanceDate);

        expect(dates).toEqual(['2026-03-02', '2026-03-03', '2026-03-04']);
    });
});
