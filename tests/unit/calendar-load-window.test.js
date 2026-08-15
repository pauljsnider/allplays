import { describe, expect, it } from 'vitest';
import {
    addCalendarLoadedRange,
    createLatestCalendarRangeLoader,
    getMissingCalendarLoadRanges,
    normalizeCalendarLoadRange
} from '../../js/calendar-load-window.js';

const range = (startDate, endDate) => ({ startDate: new Date(startDate), endDate: new Date(endDate) });

describe('calendar load window', () => {
    it('normalizes valid ranges and rejects reversed ranges', () => {
        expect(normalizeCalendarLoadRange('2026-01-01', '2026-01-31')).toEqual(range('2026-01-01', '2026-01-31'));
        expect(() => normalizeCalendarLoadRange('2026-02-01', '2026-01-31')).toThrow();
    });

    it('finds only the uncovered portions of overlapping ranges', () => {
        expect(getMissingCalendarLoadRanges(
            [range('2026-01-10', '2026-01-20'), range('2026-01-30', '2026-02-05')],
            range('2026-01-01', '2026-02-10')
        )).toEqual([
            range('2026-01-01', '2026-01-09T23:59:59.999Z'),
            range('2026-01-20T00:00:00.001Z', '2026-01-29T23:59:59.999Z'),
            range('2026-02-05T00:00:00.001Z', '2026-02-10')
        ]);
    });

    it('merges repeated and adjacent loads so repeated navigation has no gap', () => {
        const loaded = addCalendarLoadedRange(
            addCalendarLoadedRange([], range('2026-01-01', '2026-01-31T23:59:59.999Z')),
            range('2026-02-01', '2026-02-28T23:59:59.999Z')
        );
        expect(loaded).toEqual([range('2026-01-01', '2026-02-28T23:59:59.999Z')]);
        expect(getMissingCalendarLoadRanges(loaded, range('2026-01-15', '2026-02-15'))).toEqual([]);
    });

    it('supports explicit all-history state without making bounded ranges unbounded', () => {
        const allHistory = new Map();
        allHistory.set('team-1', true);
        expect(allHistory.get('team-1')).toBe(true);
        expect(getMissingCalendarLoadRanges([], range('2026-03-01', '2026-03-31'))).toHaveLength(1);
    });

    it('loads the latest requested range after an overlapping load completes', async () => {
        let finishFirstLoad;
        const loaded = [];
        const loadRange = createLatestCalendarRangeLoader(async (requestedRange) => {
            loaded.push(requestedRange);
            if (loaded.length === 1) {
                await new Promise((resolve) => { finishFirstLoad = resolve; });
            }
        });
        const january = range('2026-01-01', '2026-01-31');
        const february = range('2026-02-01', '2026-02-28');

        const firstPromise = loadRange(january);
        const overlappingPromise = loadRange(february);
        expect(loaded).toEqual([january]);

        finishFirstLoad();
        await Promise.all([firstPromise, overlappingPromise]);
        expect(loaded).toEqual([january, february]);
    });
});
