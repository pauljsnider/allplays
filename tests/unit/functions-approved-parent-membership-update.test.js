import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
const { appendUniqueParentLink, appendUniqueValue } = require('../../functions/parent-invite-auto-link-core.cjs');

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

    return new Function('appendUniqueParentLink', 'appendUniqueValue', `
        ${uniqueNonEmptyStringsSource}
        ${buildApprovedParentMembershipUserUpdateSource}
        return { buildApprovedParentMembershipUserUpdate };
    `)(appendUniqueParentLink, appendUniqueValue);
}

describe('buildApprovedParentMembershipUserUpdate', () => {
    it('recomputes access keys when an approved link already exists in parentOf', () => {
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
                    teamName: 'Old Team',
                    playerName: 'Jordan'
                }
            ],
            parentTeamIds: ['team-1'],
            parentPlayerKeys: ['team-1::player-1'],
            roles: ['parent']
        });
    });
});
