import { describe, it, expect } from 'vitest';
import { getEditConfigAccessDecision } from '../../js/edit-config-access.js';

const TEAM = {
    id: 'team-1',
    ownerId: 'owner-1',
    adminEmails: ['coach@example.com']
};

describe('edit config access decision', () => {
    it('allows platform admins to manage stats configs', () => {
        expect(getEditConfigAccessDecision({ uid: 'admin-1', isAdmin: true }, TEAM, TEAM.id)).toEqual({
            allowed: true,
            exitUrl: 'dashboard.html',
            team: TEAM
        });
    });

    it('allows rules-compatible team admins to manage stats configs', () => {
        expect(getEditConfigAccessDecision({ uid: 'coach-1', email: 'Coach@Example.com' }, TEAM, TEAM.id)).toEqual({
            allowed: true,
            exitUrl: 'dashboard.html',
            team: TEAM
        });
    });

    it('denies legacy-normalized admin emails that Firestore would reject for config writes', () => {
        const legacyTeam = {
            ...TEAM,
            adminEmails: [' Coach@Example.com ']
        };

        expect(getEditConfigAccessDecision({ uid: 'coach-1', email: 'coach@example.com' }, legacyTeam, TEAM.id)).toEqual({
            allowed: false,
            exitUrl: 'dashboard.html',
            team: legacyTeam
        });
    });

    it('denies profile-email-only admin access that Firestore would reject for config writes', () => {
        expect(getEditConfigAccessDecision({ uid: 'coach-1', profileEmail: 'coach@example.com' }, TEAM, TEAM.id)).toEqual({
            allowed: false,
            exitUrl: 'dashboard.html',
            team: TEAM
        });
    });

    it('denies parent-only access for stats config page', () => {
        expect(
            getEditConfigAccessDecision(
                { uid: 'parent-1', parentOf: [{ teamId: TEAM.id, playerId: 'player-1' }] },
                TEAM,
                TEAM.id
            )
        ).toEqual({
            allowed: false,
            exitUrl: 'parent-dashboard.html',
            team: TEAM
        });
    });

    it('denies access when the team cannot be resolved', () => {
        expect(getEditConfigAccessDecision({ uid: 'admin-1', isAdmin: true }, null, 'missing-team')).toEqual({
            allowed: false,
            exitUrl: 'dashboard.html',
            team: null
        });
    });
});
