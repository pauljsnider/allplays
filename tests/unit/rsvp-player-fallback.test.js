import { describe, expect, it } from 'vitest';
import { buildGameDayRsvpBreakdown } from '../../js/game-day-rsvp-breakdown.js';
import {
    buildRsvpFallbackPlayerIdsByUser,
    extractPlayerIdsFromParentScope,
    uniqueNonEmptyIds
} from '../../js/rsvp-player-fallback.js';

describe('RSVP player fallback attribution', () => {
    it('accepts only string document ids', () => {
        expect(uniqueNonEmptyIds([' player-1 ', 'player-1', 42, { id: 'player-2' }, null])).toEqual(['player-1']);
    });

    it('maps a user-level parent RSVP through parentPlayerKeys', async () => {
        const rsvps = [
            { id: 'parent-1', userId: 'parent-1', response: 'going', respondedAt: '2026-07-01T12:00:00.000Z' }
        ];
        const players = [
            { id: 'player-1', name: 'Avery', number: '7' },
            { id: 'player-2', name: 'Blake', number: '12' }
        ];

        const fallbackByUser = await buildRsvpFallbackPlayerIdsByUser({
            teamId: 'team-1',
            rsvps,
            players,
            resolveIdsForUser: async () => extractPlayerIdsFromParentScope('team-1', {
                parentOf: [],
                parentPlayerKeys: ['team-1::player-1', 'team-2::player-9']
            })
        });

        const breakdown = buildGameDayRsvpBreakdown({ players, rsvps, fallbackByUser });

        expect(fallbackByUser.get('parent-1')).toEqual(['player-1']);
        expect(breakdown.grouped.going).toEqual([
            expect.objectContaining({
                playerId: 'player-1',
                response: 'going',
                responderUserId: 'parent-1'
            })
        ]);
        expect(breakdown.grouped.not_responded).toEqual([
            expect.objectContaining({ playerId: 'player-2', response: 'not_responded' })
        ]);
    });

    it('uses team-scoped private roster parent user IDs when user profile reads are denied', async () => {
        const denied = new Error('denied');
        denied.code = 'permission-denied';
        const rsvps = [
            { id: 'parent-2', userId: 'parent-2', response: 'maybe', respondedAt: '2026-07-01T12:00:00.000Z' }
        ];
        const players = [
            { id: 'player-1', name: 'Avery', number: '7', privateProfileParents: [{ userId: 'parent-2', email: 'parent@example.com' }] },
            { id: 'player-2', name: 'Blake', number: '12' }
        ];

        const fallbackByUser = await buildRsvpFallbackPlayerIdsByUser({
            teamId: 'team-1',
            rsvps,
            players,
            resolveIdsForUser: async () => {
                throw denied;
            }
        });

        const breakdown = buildGameDayRsvpBreakdown({ players, rsvps, fallbackByUser });

        expect(fallbackByUser.get('parent-2')).toEqual(['player-1']);
        expect(breakdown.grouped.maybe).toEqual([
            expect.objectContaining({
                playerId: 'player-1',
                response: 'maybe',
                responderUserId: 'parent-2'
            })
        ]);
        expect(breakdown.counts).toEqual({
            going: 0,
            maybe: 1,
            notGoing: 0,
            notResponded: 1,
            total: 2
        });
    });
});
