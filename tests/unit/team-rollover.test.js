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

    it('copies medical and emergency contact info during rollover', () => {
        const medicalInfo = { allergies: 'peanuts' };
        const emergencyContact = { name: 'Jane Doe', phone: '555-1234' };
        const copy = buildRolloverPlayerCopy({
            id: 'player-1',
            name: 'Sam Player',
            medicalInfo,
            emergencyContact,
            sourceTeamId: 'older-team',
            sourcePlayerId: 'older-player',
            rolledOverAt: { old: true },
            deactivatedAt: { old: true }
        }, 'team-old', { marker: 'now' });

        expect(copy).toHaveProperty('medicalInfo', medicalInfo);
        expect(copy).toHaveProperty('emergencyContact', emergencyContact);
        expect(copy).not.toHaveProperty('deactivatedAt');
        expect(copy.sourceTeamId).toBe('team-old');
        expect(copy.sourcePlayerId).toBe('player-1');
    });
});
