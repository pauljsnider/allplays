import { describe, it, expect } from 'vitest';
import { canUserDiscoverPlayerInSearch, filterSearchableTeams } from '../../js/global-search-visibility.js';

const teams = [
    { id: 'public-team', name: 'Public Team', isPublic: true, ownerId: 'owner-1', adminEmails: ['coach@example.com'] },
    { id: 'private-team', name: 'Private Team', isPublic: false, ownerId: 'owner-1', adminEmails: ['coach@example.com'] }
];

describe('global search visibility', () => {
    it('hides private teams from anonymous search results', () => {
        expect(filterSearchableTeams(teams, null).map((team) => team.id)).toEqual(['public-team']);
    });

    it('keeps private teams visible to the owner', () => {
        expect(filterSearchableTeams(teams, { uid: 'owner-1', email: 'owner@example.com' }).map((team) => team.id)).toEqual([
            'public-team',
            'private-team'
        ]);
    });

    it('keeps private teams visible to a team admin', () => {
        expect(filterSearchableTeams(teams, { uid: 'coach-1', email: 'coach@example.com' }).map((team) => team.id)).toEqual([
            'public-team',
            'private-team'
        ]);
    });

    it('keeps private teams visible to a linked parent', () => {
        expect(filterSearchableTeams(teams, {
            uid: 'parent-1',
            email: 'parent@example.com',
            parentOf: [{ teamId: 'private-team', playerId: 'player-1' }]
        }).map((team) => team.id)).toEqual([
            'public-team',
            'private-team'
        ]);
    });

    it('hides players from private teams for users without team access', () => {
        const teamsById = new Map(teams.map((team) => [team.id, team]));

        expect(canUserDiscoverPlayerInSearch('private-team', teamsById, null)).toBe(false);
        expect(canUserDiscoverPlayerInSearch('private-team', teamsById, { uid: 'other-user', email: 'other@example.com' })).toBe(false);
    });

    it('keeps players visible only when their team is searchable', () => {
        const teamsById = new Map(teams.map((team) => [team.id, team]));

        expect(canUserDiscoverPlayerInSearch('public-team', teamsById, null)).toBe(true);
        expect(canUserDiscoverPlayerInSearch('private-team', teamsById, { uid: 'owner-1', email: 'owner@example.com' })).toBe(true);
    });

    it('hides players when the team was not loaded into searchable team context', () => {
        const teamsById = new Map(teams.filter((team) => team.id !== 'private-team').map((team) => [team.id, team]));

        expect(canUserDiscoverPlayerInSearch('private-team', teamsById, { uid: 'owner-1', email: 'owner@example.com' })).toBe(false);
    });
});
