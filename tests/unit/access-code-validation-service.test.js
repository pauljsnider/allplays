import { describe, expect, it } from 'vitest';

const { validateAccessCodeCandidates } = await import('../../functions/access-code-validation.cjs');

describe('access code validation service', () => {
    it('returns only the minimal acceptance payload for a redeemable invite', () => {
        const result = validateAccessCodeCandidates([
            {
                id: 'invite-1',
                data: {
                    code: 'PARENT1',
                    type: 'parent_invite',
                    email: 'parent@example.com',
                    phone: '555-0100',
                    teamId: 'team-1',
                    teamName: 'Bears',
                    playerId: 'player-1',
                    playerName: 'Pat Player',
                    playerNum: '7',
                    generatedBy: 'coach-1',
                    used: false,
                    expiresAt: Date.now() + 60_000
                }
            }
        ]);

        expect(result).toEqual({
            valid: true,
            codeId: 'invite-1',
            type: 'parent_invite',
            data: {
                code: 'PARENT1',
                email: 'parent@example.com',
                teamId: 'team-1',
                teamName: 'Bears',
                playerId: 'player-1',
                playerName: 'Pat Player',
                playerNum: '7',
                type: 'parent_invite'
            }
        });
        expect(result.data).not.toHaveProperty('phone');
        expect(result.data).not.toHaveProperty('generatedBy');
    });

    it('rejects revoked, used, and expired invites with clear messages', () => {
        expect(validateAccessCodeCandidates([
            { id: 'revoked', data: { code: 'REVOKE1', revoked: true, used: false } }
        ])).toEqual({ valid: false, message: 'Invite is no longer active' });

        expect(validateAccessCodeCandidates([
            { id: 'used', data: { code: 'USED001', used: true } }
        ])).toEqual({ valid: false, message: 'Code already used' });

        expect(validateAccessCodeCandidates([
            { id: 'expired', data: { code: 'EXPIRE1', used: false, expiresAt: Date.now() - 1_000 } }
        ])).toEqual({ valid: false, message: 'Code has expired' });
    });
});
