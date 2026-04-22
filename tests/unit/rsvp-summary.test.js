import { describe, expect, it } from 'vitest';
import { computeEffectiveRsvpSummary } from '../../js/rsvp-summary.js';

const normalizeResponse = (response) => {
    if (response === 'going' || response === 'maybe' || response === 'not_going') return response;
    return 'not_responded';
};

const resolvePlayerIds = (rsvp) => Array.isArray(rsvp?.playerIds) ? rsvp.playerIds : [];

describe('effective RSVP summary', () => {
    it('counts a coach override for one player without double-counting the parent multi-player RSVP', () => {
        const rosterIds = new Set(['p1', 'p2']);
        const rsvps = [
            {
                id: 'parent-1',
                userId: 'parent-1',
                playerIds: ['p1', 'p2'],
                response: 'going',
                respondedAt: '2026-03-04T11:00:00.000Z'
            },
            {
                id: 'coach-1__p1',
                userId: 'coach-1',
                playerIds: ['p1'],
                response: 'not_going',
                respondedAt: '2026-03-04T11:05:00.000Z'
            }
        ];

        const summary = computeEffectiveRsvpSummary({
            rsvps,
            activeRosterIds: rosterIds,
            fallbackByUser: new Map(),
            normalizeResponse,
            resolvePlayerIds
        });

        expect(summary).toEqual({
            going: 1,
            maybe: 0,
            notGoing: 1,
            notResponded: 0,
            total: 2
        });
    });

    it('lets a newer parent multi-player RSVP reclaim precedence from an older coach override', () => {
        const rosterIds = new Set(['p1', 'p2']);
        const rsvps = [
            {
                id: 'coach-1__p1',
                userId: 'coach-1',
                playerIds: ['p1'],
                response: 'not_going',
                respondedAt: '2026-03-04T11:00:00.000Z'
            },
            {
                id: 'parent-1',
                userId: 'parent-1',
                playerIds: ['p1', 'p2'],
                response: 'maybe',
                respondedAt: '2026-03-04T11:07:00.000Z'
            }
        ];

        const summary = computeEffectiveRsvpSummary({
            rsvps,
            activeRosterIds: rosterIds,
            fallbackByUser: new Map(),
            normalizeResponse,
            resolvePlayerIds
        });

        expect(summary).toEqual({
            going: 0,
            maybe: 2,
            notGoing: 0,
            notResponded: 0,
            total: 2
        });
    });
});
