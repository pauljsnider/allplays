import { describe, expect, it } from 'vitest';

import { getLiveClockViewModel } from '../../apps/app/src/lib/scheduleLogic.ts';

describe('React app schedule live clock formatting', () => {
    it('formats a stopped persisted live period and clock', () => {
        const clock = getLiveClockViewModel({
            type: 'game',
            liveStatus: 'live',
            liveClockMs: 494000,
            liveClockRunning: false,
            liveClockPeriod: 'Q2',
            liveClockUpdatedAt: new Date('2026-05-28T07:10:00Z')
        }, new Date('2026-05-28T07:12:00Z'));

        expect(clock?.label).toBe('LIVE · Q2 · 08:14');
    });

    it('hides output when live clock fields are absent', () => {
        expect(getLiveClockViewModel({
            type: 'game',
            liveStatus: 'scheduled',
            liveClockMs: null,
            liveClockRunning: null,
            liveClockPeriod: null,
            liveClockUpdatedAt: null
        })).toBeNull();
    });

    it('advances a recent running clock without producing negative or NaN values', () => {
        const clock = getLiveClockViewModel({
            type: 'game',
            liveStatus: 'live',
            liveClockMs: 494000,
            liveClockRunning: true,
            liveClockPeriod: 'Q2',
            liveClockUpdatedAt: new Date('2026-05-28T07:10:00Z')
        }, new Date('2026-05-28T07:10:05Z'));

        expect(clock?.label).toBe('LIVE · Q2 · 08:19');

        const futureUpdatedAt = getLiveClockViewModel({
            type: 'game',
            liveStatus: 'live',
            liveClockMs: 494000,
            liveClockRunning: true,
            liveClockPeriod: 'Q2',
            liveClockUpdatedAt: new Date('2026-05-28T07:11:00Z')
        }, new Date('2026-05-28T07:10:05Z'));

        expect(futureUpdatedAt?.label).toBe('LIVE · Q2 · 08:14');
    });
});
