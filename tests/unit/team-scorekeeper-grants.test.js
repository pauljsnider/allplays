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
            selectedIds: Array.from(getSelectedScorekeeperIds(context.team))
        };
    `);
}

describe('team scorekeeper grants', () => {
    it('wires the team page to grant and revoke scoped scorekeeper access', () => {
        const source = readTeamHtml();

        expect(source).toContain('id="team-scorekeeper-section"');
        expect(source).toContain('grantScorekeeperAccess');
        expect(source).toContain('revokeScorekeeperAccess');
        expect(source).toContain('window.toggleScorekeeperGrant = toggleScorekeeperGrant;');
        expect(source).toContain('renderScorekeeperGrantControls(team, players);');
    });

    it('limits grant management to full team access and linked roster users', () => {
        const helpers = loadScorekeeperHelpers();

        expect(helpers({
            currentUser: { uid: 'coach-1' },
            currentTeamAccessInfo: { hasAccess: true, accessLevel: 'full' },
            player: { name: 'Player', authUid: ' member-1 ' },
            team: { teamPermissions: { scorekeeping: { mode: 'selected', memberIds: [' member-1 '] } } }
        })).toEqual({
            canManageScorekeeperGrants: true,
            memberUserId: 'member-1',
            selectedIds: ['member-1']
        });

        expect(helpers({
            currentUser: { uid: 'parent-1' },
            currentTeamAccessInfo: { hasAccess: true, accessLevel: 'parent' },
            player: { name: 'Player', authUid: 'member-1' },
            team: { teamPermissions: { scorekeeping: { mode: 'selected', memberIds: ['member-1'] } } }
        }).canManageScorekeeperGrants).toBe(false);
    });
});
