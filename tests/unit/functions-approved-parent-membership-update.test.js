import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
const { appendUniqueValue } = require('../../functions/parent-invite-auto-link-core.cjs');
const { addCanonicalParentAccessLink } = require('../../functions/parent-access-core.cjs');

function getFunctionSource(functionName) {
    const start = functionsSource.indexOf(`function ${functionName}`);
    expect(start).toBeGreaterThanOrEqual(0);
    const nextFunction = functionsSource.indexOf('\nfunction ', start + 1);
    const nextExport = functionsSource.indexOf('\nexports.', start + 1);
    const candidates = [nextFunction, nextExport].filter((value) => value !== -1);
    const end = candidates.length > 0 ? Math.min(...candidates) : functionsSource.length;
    return functionsSource.slice(start, end);
}

function loadHelpers() {
    const uniqueNonEmptyStringsSource = getFunctionSource('uniqueNonEmptyStrings');
    const buildApprovedParentMembershipUserUpdateSource = getFunctionSource('buildApprovedParentMembershipUserUpdate');

    return new Function('addCanonicalParentAccessLink', 'appendUniqueValue', `
        ${uniqueNonEmptyStringsSource}
        ${buildApprovedParentMembershipUserUpdateSource}
        return { buildApprovedParentMembershipUserUpdate };
    `)(addCanonicalParentAccessLink, appendUniqueValue);
}

describe('buildApprovedParentMembershipUserUpdate', () => {
    it('adds only the approved link when stale parent metadata is no longer canonical', () => {
        const { buildApprovedParentMembershipUserUpdate } = loadHelpers();

        const result = buildApprovedParentMembershipUserUpdate({
            userData: {
                parentOf: [
                    { teamId: 'team-1', playerId: 'player-1', teamName: 'Old Team', playerName: 'Jordan' }
                ],
                parentTeamIds: [],
                parentPlayerKeys: [],
                roles: []
            },
            requestData: {
                teamId: 'team-1',
                playerId: 'player-1',
                relation: 'Parent'
            },
            team: { id: 'team-1', name: 'Team One' },
            player: { id: 'player-1', name: 'Jordan', number: '23', photoUrl: null }
        });

        expect(result).toEqual({
            parentOf: [
                {
                    teamId: 'team-1',
                    playerId: 'player-1',
                    teamName: 'Team One',
                    playerName: 'Jordan',
                    playerNumber: '23',
                    playerPhotoUrl: null,
                    relation: 'Parent'
                }
            ],
            parentTeamIds: ['team-1'],
            parentPlayerKeys: ['team-1::player-1'],
            roles: ['parent']
        });
    });

    it('does not restore revoked siblings or teams while approving a new link', () => {
        const { buildApprovedParentMembershipUserUpdate } = loadHelpers();

        const result = buildApprovedParentMembershipUserUpdate({
            userData: {
                parentOf: [
                    { teamId: 'team-1', playerId: 'player-current' },
                    { teamId: 'team-1', playerId: 'player-revoked' },
                    { teamId: 'team-old', playerId: 'player-old' }
                ],
                parentTeamIds: ['team-1'],
                parentPlayerKeys: ['team-1::player-current'],
                roles: ['parent']
            },
            requestData: { teamId: 'team-2', playerId: 'player-new' },
            team: { id: 'team-2', name: 'Team Two' },
            player: { id: 'player-new', name: 'New Player' }
        });

        expect(result.parentOf.map((link) => `${link.teamId}::${link.playerId}`)).toEqual([
            'team-1::player-current',
            'team-2::player-new'
        ]);
        expect(result.parentTeamIds).toEqual(['team-1', 'team-2']);
        expect(result.parentPlayerKeys).toEqual(['team-1::player-current', 'team-2::player-new']);
    });
});
