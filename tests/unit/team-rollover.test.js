import { describe, expect, it } from 'vitest';
import { buildRolloverPlayerCopy } from '../../js/team-rollover.js';

describe('team rollover player copy', () => {
    it('preserves supported public player and family fields with source audit metadata', () => {
        const rolledOverAt = { marker: 'now' };
        const copy = buildRolloverPlayerCopy({
            id: 'player-1',
            name: 'Sam Player',
            number: '12',
            position: 'Guard',
            photoUrl: 'https://example.test/player.png',
            active: false,
            parents: [{ userId: 'parent-1', email: 'parent@example.com', relation: 'Mom' }],
            createdAt: { old: true },
            updatedAt: { old: true }
        }, 'team-old', rolledOverAt);

        expect(copy).toEqual({
            name: 'Sam Player',
            number: '12',
            position: 'Guard',
            photoUrl: 'https://example.test/player.png',
            active: true,
            parents: [{ userId: 'parent-1', email: 'parent@example.com', relation: 'Mom' }],
            sourceTeamId: 'team-old',
            sourcePlayerId: 'player-1',
            rolledOverAt
        });
    });

    it('does not copy sensitive or stale rollover fields', () => {
        const copy = buildRolloverPlayerCopy({
            id: 'player-1',
            name: 'Sam Player',
            medicalInfo: 'private',
            emergencyContact: 'private',
            sourceTeamId: 'older-team',
            sourcePlayerId: 'older-player',
            rolledOverAt: { old: true },
            deactivatedAt: { old: true }
        }, 'team-old', { marker: 'now' });

        expect(copy).not.toHaveProperty('medicalInfo');
        expect(copy).not.toHaveProperty('emergencyContact');
        expect(copy).not.toHaveProperty('deactivatedAt');
        expect(copy.sourceTeamId).toBe('team-old');
        expect(copy.sourcePlayerId).toBe('player-1');
    });
});
