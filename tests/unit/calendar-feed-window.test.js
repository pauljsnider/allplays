import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
    CALENDAR_FEED_LOOKAHEAD_DAYS,
    CALENDAR_FEED_LOOKBACK_DAYS,
    buildCalendarFeedGamesQuery,
    getCalendarFeedDateWindow
} = require('../../functions/calendar-feed-window-core.cjs');

describe('calendar feed game query window', () => {
    it('keeps recent history and one future season in a bounded window', () => {
        const { start, end } = getCalendarFeedDateWindow(new Date('2026-07-11T12:00:00.000Z'));

        expect(CALENDAR_FEED_LOOKBACK_DAYS).toBe(90);
        expect(CALENDAR_FEED_LOOKAHEAD_DAYS).toBe(365);
        expect(start.toISOString()).toBe('2026-04-12T12:00:00.000Z');
        expect(end.toISOString()).toBe('2027-07-11T12:00:00.000Z');
    });

    it('applies inclusive date bounds before ordering the games query', () => {
        const query = {
            where: vi.fn(),
            orderBy: vi.fn()
        };
        query.where.mockReturnValue(query);
        query.orderBy.mockReturnValue(query);

        const result = buildCalendarFeedGamesQuery(query, {
            now: new Date('2026-07-11T12:00:00.000Z')
        });

        expect(query.where).toHaveBeenNthCalledWith(1, 'date', '>=', new Date('2026-04-12T12:00:00.000Z'));
        expect(query.where).toHaveBeenNthCalledWith(2, 'date', '<=', new Date('2027-07-11T12:00:00.000Z'));
        expect(query.orderBy).toHaveBeenCalledWith('date');
        expect(result).toBe(query);
    });

    it('rejects invalid anchors and unqueryable collections', () => {
        expect(() => getCalendarFeedDateWindow('not-a-date')).toThrow('requires a valid date');
        expect(() => buildCalendarFeedGamesQuery(null)).toThrow('must support bounded queries');
    });
});
