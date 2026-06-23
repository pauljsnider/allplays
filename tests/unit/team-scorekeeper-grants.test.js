import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readTeamHtml() {
    return readFileSync(new URL('../../team.html', import.meta.url), 'utf8');
}

function loadScorekeeperHelpers() {
    const source = readTeamHtml();
    const start = source.indexOf('function canManageScorekeeperGrants() {');
    const end = source.indexOf('\n\n        function renderAvailabilitySettings(team)', start);

    if (start === -1 || end === -1) {
        throw new Error('Could not locate scorekeeper grant helpers in team.html');
    }

    const helperSource = source.slice(start, end);
    return new Function('context', `
        let currentUser = context.currentUser;
        let currentTeamAccessInfo = context.currentTeamAccessInfo;
        let currentTeamId = context.teamId;
        let currentTeamMemberUsers = context.users || [];
        function canManageTeamAvailability() {
            return !!currentUser && (
                currentUser?.isAdmin ||
                currentTeamAccessInfo?.accessLevel === 'full' ||
                currentTeamAccessInfo?.accessLevel === 'owner' ||
                currentTeamAccessInfo?.accessLevel === 'admin'
            );
        }
        ${helperSource}
        return {
            canManageScorekeeperGrants: canManageScorekeeperGrants(),
            memberUserId: getPlayerMemberUserId(context.player),
            grantTargets: buildScorekeeperGrantTargets(context.players || (context.player ? [context.player] : []), context.users || [], context.teamId).map((target) => ({
                userId: target.userId,
                name: target.name,
                email: target.email,
                playerNames: target.playerNames
            })),
            selectedIds: Array.from(getSelectedScorekeeperIds(context.team)),
            selectedStreamScoreIds: Array.from(getSelectedStreamScoreIds(context.team))
        };
    `);
}

describe('team scorekeeper grants', () => {
    it('pins the latest db cache-busting version for the team page module', () => {
        const source = readTeamHtml();

        expect(source).toContain("from './js/db.js?v=65'");
    });

    it('wires the team page to grant and revoke scoped scorekeeper access', () => {
        const source = readTeamHtml();

        expect(source).toContain('id="team-scorekeeper-section"');
        expect(source).toContain('grantScorekeeperAccess');
        expect(source).toContain('revokeScorekeeperAccess');
        expect(source).toContain('grantStreamScoreAccess');
        expect(source).toContain('revokeStreamScoreAccess');
        expect(source).toContain('window.toggleScorekeeperGrant = toggleScorekeeperGrant;');
        expect(source).toContain('window.toggleStreamScoreGrant = toggleStreamScoreGrant;');
        expect(source).toContain('Assign Stream & Score');
        expect(source).toContain('renderScorekeeperGrantControls(team, players);');
    });

    it('limits grant management to full team access and linked roster users', () => {
        const helpers = loadScorekeeperHelpers();

        expect(helpers({
            currentUser: { uid: 'coach-1' },
            currentTeamAccessInfo: { hasAccess: true, accessLevel: 'full' },
            player: { name: 'Player', authUid: ' member-1 ' },
            team: {
                teamPermissions: {
                    scorekeeping: { mode: 'selected', memberIds: [' member-1 '] },
                    streaming: { mode: 'selected', memberIds: ['member-1'] }
                }
            }
        })).toEqual({
            canManageScorekeeperGrants: true,
            memberUserId: 'member-1',
            grantTargets: [{
                userId: 'member-1',
                name: 'Player',
                email: '',
                playerNames: ['Player']
            }],
            selectedIds: ['member-1'],
            selectedStreamScoreIds: ['member-1']
        });

        expect(helpers({
            currentUser: { uid: 'parent-1' },
            currentTeamAccessInfo: { hasAccess: true, accessLevel: 'parent' },
            player: { name: 'Player', authUid: 'member-1' },
            team: { teamPermissions: { scorekeeping: { mode: 'selected', memberIds: ['member-1'] } } }
        }).canManageScorekeeperGrants).toBe(false);
    });

    it('resolves scorekeeper grant targets from profile and parent links', () => {
        const helpers = loadScorekeeperHelpers();
        const result = helpers({
            currentUser: { uid: 'coach-1' },
            currentTeamAccessInfo: { hasAccess: true, accessLevel: 'full' },
            teamId: 'team-1',
            players: [
                {
                    id: 'player-1',
                    name: 'Player One',
                    parents: [{ userId: ' parent-link-1 ', email: 'parent@example.com', name: 'Parent One' }]
                },
                {
                    id: 'player-2',
                    name: 'Player Two'
                }
            ],
            users: [
                {
                    id: 'profile-link-1',
                    displayName: 'Profile Parent',
                    email: 'profile@example.com',
                    parentOf: [{ teamId: 'team-1', playerId: 'player-2' }]
                },
                {
                    id: 'other-team-link',
                    displayName: 'Other Parent',
                    parentOf: [{ teamId: 'other-team', playerId: 'player-1' }]
                }
            ],
            team: { teamPermissions: { scorekeeping: { mode: 'selected', memberIds: [] } } }
        });

        expect(result.grantTargets).toEqual([
            {
                userId: 'parent-link-1',
                name: 'Parent One',
                email: 'parent@example.com',
                playerNames: ['Player One']
            },
            {
                userId: 'profile-link-1',
                name: 'Profile Parent',
                email: 'profile@example.com',
                playerNames: ['Player Two']
            }
        ]);
    });
});
