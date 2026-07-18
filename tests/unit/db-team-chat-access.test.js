import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function getFunctionSource(name) {
    const source = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
    const start = source.indexOf(`export function ${name}`);
    const next = source.indexOf('\nexport function ', start + 1);
    return source.slice(start, next === -1 ? source.length : next);
}

function buildCanAccessTeamChat() {
    return Function(`${getFunctionSource('canAccessTeamChat')
        .replace('export function canAccessTeamChat', 'return function canAccessTeamChat')}`)();
}

describe('team chat access compatibility', () => {
    const team = { id: 'team-1', ownerId: 'owner-1', adminEmails: [] };
    const canAccessTeamChat = buildCanAccessTeamChat();

    it('uses legacy parentOf when normalized parentTeamIds has not been backfilled', () => {
        expect(canAccessTeamChat({
            uid: 'parent-1',
            parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
        }, team)).toBe(true);
    });

    it('treats normalized parentTeamIds as authoritative once present', () => {
        expect(canAccessTeamChat({
            uid: 'parent-1',
            parentTeamIds: [],
            parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
        }, team)).toBe(false);
        expect(canAccessTeamChat({
            uid: 'parent-1',
            parentTeamIds: ['team-1'],
            parentOf: []
        }, team)).toBe(true);
    });
});
