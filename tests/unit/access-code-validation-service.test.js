import { describe, expect, it } from 'vitest';

const { validateAccessCodeCandidates } = await import('../../functions/access-code-validation.cjs');

describe('access code validation service', () => {
    it('returns only generic pre-auth invite state for a redeemable invite', () => {
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
                type: 'parent_invite'
            }
        });
        expect(result.data).not.toHaveProperty('email');
        expect(result.data).not.toHaveProperty('teamId');
        expect(result.data).not.toHaveProperty('teamName');
        expect(result.data).not.toHaveProperty('playerId');
        expect(result.data).not.toHaveProperty('playerName');
        expect(result.data).not.toHaveProperty('playerNum');
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
