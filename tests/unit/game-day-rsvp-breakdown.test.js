import { describe, expect, it } from 'vitest';
import { buildGameDayRsvpBreakdown } from '../../js/game-day-rsvp-breakdown.js';

describe('game day RSVP breakdown', () => {
    it('keeps the latest stored write for a player after parent and coach overwrite each other', () => {
        const breakdown = buildGameDayRsvpBreakdown({
            players: [
                { id: 'p1', name: 'Avery', number: '7' },
                { id: 'p2', name: 'Blake', number: '12' }
            ],
            rsvps: [
                {
                    id: 'parent-1',
                    userId: 'parent-1',
                    playerIds: ['p1'],
                    response: 'going',
                    respondedAt: '2026-03-29T02:00:00.000Z'
                },
                {
                    id: 'coach-1__p1',
                    userId: 'coach-1',
                    playerIds: ['p1'],
                    response: 'maybe',
                    respondedAt: '2026-03-29T02:05:00.000Z'
                },
                {
                    id: 'parent-1',
                    userId: 'parent-1',
                    playerIds: ['p1'],
                    response: 'not_going',
                    respondedAt: '2026-03-29T02:10:00.000Z'
                }
            ],
            fallbackByUser: new Map()
        });

        expect(breakdown.grouped.going).toEqual([]);
        expect(breakdown.grouped.maybe).toEqual([]);
        expect(breakdown.grouped.not_going).toEqual([
            expect.objectContaining({
                playerId: 'p1',
                playerName: 'Avery',
                playerNumber: '7',
                response: 'not_going',
                responderUserId: 'parent-1'
            })
        ]);
        expect(breakdown.grouped.not_responded).toEqual([
            expect.objectContaining({
                playerId: 'p2',
                playerName: 'Blake',
                response: 'not_responded'
            })
        ]);
        expect(breakdown.counts).toEqual({
            going: 0,
            maybe: 0,
            notGoing: 1,
            notResponded: 1,
            total: 2
        });
    });
});
