import { describe, expect, it } from 'vitest';
import { buildGameDayRsvpBreakdown } from '../../js/game-day-rsvp-breakdown.js';
import { buildRosterUserPlayerMap, createRosterBackedIdResolver } from '../../js/roster-rsvp-attribution.js';

describe('buildRosterUserPlayerMap', () => {
    it('maps parent user ids to players from player.parents and private profile parents', () => {
        const map = buildRosterUserPlayerMap([
            { id: 'p1', parents: [{ userId: 'u-dad', email: 'dad@allplays.ai' }] },
            { id: 'p2', privateProfileParents: [{ userId: 'u-dad' }, { userId: 'u-mom' }] }
        ]);
        expect(map.get('u-dad')).toEqual(['p1', 'p2']);
        expect(map.get('u-mom')).toEqual(['p2']);
    });

    it('reads legacy parentUserId/guardianUserId fields on the player doc', () => {
        const map = buildRosterUserPlayerMap([
            { id: 'p1', parentUserId: 'u-legacy' },
            { id: 'p2', guardianUserId: 'u-legacy' }
        ]);
        expect(map.get('u-legacy').sort()).toEqual(['p1', 'p2']);
    });
});

describe('createRosterBackedIdResolver', () => {
    it('prefers the coach-readable roster map over the profile resolver', async () => {
        const resolver = createRosterBackedIdResolver(
            new Map([['u-dad', ['p1']]]),
            async () => {
                throw new Error('should not read the parent profile');
            }
        );
        expect(await resolver('u-dad')).toEqual(['p1']);
    });

    it('falls back to the profile resolver when the roster has no link', async () => {
        const resolver = createRosterBackedIdResolver(new Map(), async () => ['p9']);
        expect(await resolver('u-unknown')).toEqual(['p9']);
    });
});

describe('staff RSVP attribution end to end', () => {
    it('attributes a user-level RSVP (no playerIds) to the linked player via roster data', () => {
        // Reproduces #3863: a parent responded but the RSVP doc has no playerIds,
        // and the coach cannot read the parent profile. Roster links resolve it.
        const players = [{ id: 'p1', name: 'Avery', number: '7', parents: [{ userId: 'u-dad', email: 'dad@allplays.ai' }] }];
        const rosterMap = buildRosterUserPlayerMap(players);
        const fallbackByUser = new Map();
        // Mirror what buildFallbackPlayerIdsByUser produces for an unresolved uid.
        fallbackByUser.set('u-dad', rosterMap.get('u-dad'));

        const breakdown = buildGameDayRsvpBreakdown({
            players,
            rsvps: [{ id: 'u-dad', userId: 'u-dad', response: 'going', respondedAt: '2026-03-29T02:00:00.000Z' }],
            fallbackByUser
        });

        expect(breakdown.grouped.going.map((row) => row.playerId)).toEqual(['p1']);
        expect(breakdown.grouped.not_responded).toEqual([]);
    });
});
