import { describe, it, expect, vi, afterEach } from 'vitest';
import { expandRecurrence } from '../../js/utils.js';

afterEach(() => {
    vi.useRealTimers();
});

describe('expandRecurrence weekly interval handling', () => {
    it('expands weekly recurrences every N weeks when byDays is set', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));

        const master = {
            id: 'practice-1',
            isSeriesMaster: true,
            date: new Date('2026-03-02T17:00:00Z'),
            recurrence: {
                freq: 'weekly',
                interval: 2,
                byDays: ['MO']
            }
        };

        const dates = expandRecurrence(master, 50).map((occ) => occ.instanceDate);

        expect(dates.slice(0, 4)).toEqual([
            '2026-03-02',
            '2026-03-16',
            '2026-03-30',
            '2026-04-13'
        ]);
        expect(dates).not.toContain('2026-03-09');
    });
});
