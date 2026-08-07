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

    it('uses legacy ownerEmail only when the team has no canonical owner uid', () => {
        expect(canAccessTeamChat({
            uid: 'new-owner-uid',
            email: 'OWNER@example.com'
        }, {
            id: team.id,
            adminEmails: [],
            ownerEmail: 'owner@example.com'
        })).toBe(true);
    });

    it('uses legacy ownerEmail for moderation only without a canonical owner uid', () => {
        const canModerateChat = Function(`${getFunctionSource('canModerateChat')
            .replace('export function canModerateChat', 'return function canModerateChat')}`)();

        expect(canModerateChat({
            uid: 'new-owner-uid',
            email: 'OWNER@example.com'
        }, {
            id: team.id,
            adminEmails: [],
            ownerEmail: 'owner@example.com'
        })).toBe(true);
    });

    it('denies both legacy owner aliases when they conflict', () => {
        const canModerateChat = Function(`${getFunctionSource('canModerateChat')
            .replace('export function canModerateChat', 'return function canModerateChat')}`)();
        const conflictingTeam = {
            id: team.id,
            adminEmails: [],
            ownerEmail: 'current@example.com',
            ownerEmailLower: 'former@example.com'
        };

        for (const email of ['current@example.com', 'former@example.com']) {
            const user = { uid: email, email };
            expect(canAccessTeamChat(user, conflictingTeam)).toBe(false);
            expect(canModerateChat(user, conflictingTeam)).toBe(false);
        }
    });

    it('denies stale owner email chat access and moderation when a canonical owner exists', () => {
        const canModerateChat = Function(`${getFunctionSource('canModerateChat')
            .replace('export function canModerateChat', 'return function canModerateChat')}`)();
        const formerOwner = { uid: 'former-owner', email: 'OWNER@example.com' };
        const reassignedTeam = { ...team, ownerEmail: 'owner@example.com' };

        expect(canAccessTeamChat(formerOwner, reassignedTeam)).toBe(false);
        expect(canModerateChat(formerOwner, reassignedTeam)).toBe(false);
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
