import { describe, it, expect } from 'vitest';
import { getEditConfigAccessDecision } from '../../js/edit-config-access.js';

const TEAM = {
    id: 'team-1',
    ownerId: 'owner-1',
    adminEmails: ['coach@example.com'],
    streamAccessMode: 'selected_volunteers', // For stream access
    streamVolunteerEmails: ['streamer@example.com'] // For stream access
};

// Mock user data
const PARENT_USER = { uid: 'parent-1', parentOf: [{ teamId: TEAM.id, playerId: 'child-1' }], email: 'parent@example.com' };
const STREAM_USER = { uid: 'streamer-1', email: 'streamer@example.com' };
const REGULAR_USER = { uid: 'member-1', email: 'member@example.com' };


describe('edit config access decision', () => {
    it('allows platform admins to manage stats configs', () => {
        expect(getEditConfigAccessDecision({ uid: 'admin-1', isAdmin: true }, TEAM, TEAM.id, 'stat_settings')).toEqual({
            allowed: true,
            exitUrl: 'dashboard.html',
            team: TEAM
        });
    });

    it('allows rules-compatible team admins to manage stats configs', () => {
        expect(getEditConfigAccessDecision({ uid: 'coach-1', email: 'Coach@Example.com' }, TEAM, TEAM.id, 'stat_settings')).toEqual({
            allowed: true,
            exitUrl: 'dashboard.html',
            team: TEAM
        });
    });

    it('denies legacy-normalized admin emails for stats configs because Firestore writes require canonical admin emails', () => {
        const legacyTeam = {
            ...TEAM,
            adminEmails: [' Coach@Example.com ']
        };

        expect(getEditConfigAccessDecision({ uid: 'coach-1', email: 'coach@example.com' }, legacyTeam, TEAM.id, 'stat_settings')).toEqual({
            allowed: false,
            exitUrl: 'dashboard.html',
            team: legacyTeam
        });
    });

    it('denies profile-email-only admin access that Firestore would reject for config writes', () => {
        expect(getEditConfigAccessDecision({ uid: 'coach-1', profileEmail: 'coach@example.com' }, TEAM, TEAM.id, 'stat_settings')).toEqual({
            allowed: false,
            exitUrl: 'dashboard.html',
            team: TEAM
        });
    });

    it('denies parent-only access for stats config page (default configType)', () => {
        expect(
            getEditConfigAccessDecision(
                PARENT_USER,
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
        expect(getEditConfigAccessDecision({ uid: 'admin-1', isAdmin: true }, null, 'missing-team', 'stat_settings')).toEqual({
            allowed: false,
            exitUrl: 'dashboard.html',
            team: null
        });
    });

    it('allows stream users to manage stream settings', () => {
        // hasStreamTeamAccess will be true for STREAM_USER based on TEAM config
        expect(getEditConfigAccessDecision(STREAM_USER, TEAM, TEAM.id, 'stream_settings')).toEqual({
            allowed: true,
            exitUrl: `team.html#teamId=${TEAM.id}`,
            team: TEAM
        });
    });

    it('denies stream users from managing stat settings', () => {
        expect(getEditConfigAccessDecision(STREAM_USER, TEAM, TEAM.id, 'stat_settings')).toEqual({
            allowed: false,
            exitUrl: `team.html#teamId=${TEAM.id}`,
            team: TEAM
        });
    });

    it('allows parent users to manage child profiles', () => {
        // getTeamAccessInfo will return accessLevel: 'parent' for PARENT_USER
        expect(getEditConfigAccessDecision(PARENT_USER, TEAM, TEAM.id, 'child_profile')).toEqual({
            allowed: true,
            exitUrl: 'parent-dashboard.html',
            team: TEAM
        });
    });

    it('denies parent users from managing stat settings', () => {
        expect(getEditConfigAccessDecision(PARENT_USER, TEAM, TEAM.id, 'stat_settings')).toEqual({
            allowed: false,
            exitUrl: 'parent-dashboard.html',
            team: TEAM
        });
    });
});
