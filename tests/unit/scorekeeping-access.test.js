import { describe, expect, it } from 'vitest';
import { getTeamAccessInfo, hasFullTeamAccess, hasScorekeepingTeamAccess } from '../../js/team-access.js';

const TEAM = {
    id: 'team-1',
    ownerId: 'owner-1',
    adminEmails: ['admin@example.com']
};
const GAME = { id: 'game-1', status: 'scheduled' };

describe('scorekeeping access helpers', () => {
    it('grants delegated scorekeepers limited scorekeeping access without full access', () => {
        const team = {
            ...TEAM,
            teamPermissions: {
                scorekeeping: { mode: 'selected', memberIds: ['scorekeeper-1'] }
            }
        };
        const user = { uid: 'scorekeeper-1', email: 'volunteer@example.com' };

        expect(hasScorekeepingTeamAccess(user, team, GAME)).toBe(true);
        expect(hasFullTeamAccess(user, team)).toBe(false);
        expect(getTeamAccessInfo(user, team, { game: GAME })).toEqual({
            hasAccess: true,
            accessLevel: 'scorekeep',
            exitUrl: 'team.html#teamId=team-1'
        });
    });

    it('grants any confirmed member scorekeeping access when enabled', () => {
        const team = {
            ...TEAM,
            teamPermissions: {
                scorekeeping: { mode: 'all_confirmed', memberIds: [] }
            }
        };

        expect(hasScorekeepingTeamAccess({ uid: 'member-1' }, team, GAME, { response: 'going' })).toBe(true);
        expect(hasScorekeepingTeamAccess({ uid: 'member-1' }, team, GAME, { response: 'maybe' })).toBe(false);
    });

    it('denies confirmed users when scorekeeping permissions are not configured', () => {
        expect(hasScorekeepingTeamAccess({ uid: 'member-1' }, TEAM, GAME, { response: 'going' })).toBe(false);
    });

    it('denies users without full access or scorekeeping permission', () => {
        const team = {
            ...TEAM,
            teamPermissions: {
                scorekeeping: { mode: 'selected', memberIds: ['scorekeeper-1'] }
            }
        };

        expect(hasScorekeepingTeamAccess({ uid: 'random-1' }, team, GAME)).toBe(false);
        expect(getTeamAccessInfo({ uid: 'random-1' }, team, { game: GAME })).toEqual({
            hasAccess: false,
            accessLevel: null,
            exitUrl: 'index.html'
        });
    });

    it('does not grant scorekeeping access for cancelled games', () => {
        const team = {
            ...TEAM,
            teamPermissions: {
                scorekeeping: { mode: 'selected', memberIds: ['scorekeeper-1'] }
            }
        };

        expect(hasScorekeepingTeamAccess({ uid: 'scorekeeper-1' }, team, { id: 'game-1', status: 'cancelled' })).toBe(false);
    });
});
