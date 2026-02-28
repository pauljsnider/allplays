import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { expandRecurrence } from '../../js/utils.js';

function buildMaster(interval = 2) {
    return {
        id: 'm1',
        isSeriesMaster: true,
        date: new Date('2026-03-02T18:00:00Z'),
        startTime: '18:00',
        endTime: '19:00',
        recurrence: {
            freq: 'weekly',
            interval,
            byDays: ['MO']
        },
        exDates: [],
        overrides: {}
    };
}

function buildDailyMaster(interval = 2) {
    return {
        id: 'd1',
        isSeriesMaster: true,
        date: new Date('2026-03-02T18:00:00Z'),
        startTime: '18:00',
        endTime: '19:00',
        recurrence: {
            freq: 'daily',
            interval
        },
        exDates: [],
        overrides: {}
    };
}

function buildMultiDayWeeklyMaster(interval = 2) {
    return {
        id: 'w2',
        isSeriesMaster: true,
        date: new Date('2026-03-04T18:00:00Z'),
        startTime: '18:00',
        endTime: '19:00',
        recurrence: {
            freq: 'weekly',
            interval,
            byDays: ['MO', 'WE']
        },
        exDates: [],
        overrides: {}
    };
}

describe('expandRecurrence weekly interval behavior', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-01T00:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('honors biweekly interval for weekly recurrences', () => {
        const occurrences = expandRecurrence(buildMaster(2), 40);
        const firstFive = occurrences.slice(0, 5).map((item) => item.instanceDate);

        expect(firstFive).toEqual([
            '2026-03-02',
            '2026-03-16',
            '2026-03-30'
        ]);
    });

    it('keeps weekly interval 1 behavior unchanged', () => {
        const occurrences = expandRecurrence(buildMaster(1), 28);
        const firstFour = occurrences.slice(0, 4).map((item) => item.instanceDate);

        expect(firstFour).toEqual([
            '2026-03-02',
            '2026-03-09',
            '2026-03-16',
            '2026-03-23'
        ]);
    });

    it('uses calendar week boundaries for multi-day biweekly recurrences', () => {
        const occurrences = expandRecurrence(buildMultiDayWeeklyMaster(2), 40);
        const firstFive = occurrences.slice(0, 5).map((item) => item.instanceDate);

        expect(firstFive).toEqual([
            '2026-03-04',
            '2026-03-16',
            '2026-03-18',
            '2026-03-30',
            '2026-04-01'
        ]);
    });
});

describe('expandRecurrence daily interval behavior', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-01T00:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('honors every-2-days interval for daily recurrences', () => {
        const occurrences = expandRecurrence(buildDailyMaster(2), 8);
        const firstFive = occurrences.slice(0, 5).map((item) => item.instanceDate);

        expect(firstFive).toEqual([
            '2026-03-02',
            '2026-03-04',
            '2026-03-06',
            '2026-03-08'
        ]);
    });

    it('keeps daily interval 1 behavior unchanged', () => {
        const occurrences = expandRecurrence(buildDailyMaster(1), 5);
        const firstFive = occurrences.slice(0, 5).map((item) => item.instanceDate);

        expect(firstFive).toEqual([
            '2026-03-02',
            '2026-03-03',
            '2026-03-04',
            '2026-03-05',
            '2026-03-06'
        ]);
    });
});
