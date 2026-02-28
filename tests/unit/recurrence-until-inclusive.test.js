import { describe, it, expect, vi, afterEach } from 'vitest';
import { expandRecurrence } from '../../js/utils.js';

afterEach(() => {
    vi.useRealTimers();
});

describe('expandRecurrence until end date inclusivity', () => {
    it('includes occurrences on the until calendar date for non-midnight start times', () => {
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
});
