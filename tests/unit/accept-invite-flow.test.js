import { describe, it, expect, vi } from 'vitest';
import { createInviteProcessor } from '../../js/accept-invite-flow.js';

describe('accept invite flow', () => {
    it('marks admin invite code as used after successful redemption', async () => {
        const calls = [];
        const deps = {
            validateAccessCode: vi.fn(async () => {
                calls.push('validate');
                return {
                    valid: true,
                    codeId: 'code-123',
                    type: 'admin_invite',
                    data: { teamId: 'team-1' }
                };
            }),
            redeemParentInvite: vi.fn(),
            updateUserProfile: vi.fn(async () => {
                calls.push('profile');
            }),
            getTeam: vi.fn(async () => ({ id: 'team-1', name: 'Tigers', adminEmails: [] })),
            getUserProfile: vi.fn(async () => ({ email: 'coach@example.com' })),
            markAccessCodeAsUsed: vi.fn(async () => {
                calls.push('mark');
            })
        };

        const processInvite = createInviteProcessor(deps);
        const result = await processInvite('user-1', 'ABCD1234');

        expect(result.success).toBe(true);
        expect(result.redirectUrl).toBe('dashboard.html');
        expect(deps.markAccessCodeAsUsed).toHaveBeenCalledWith('code-123', 'user-1');
        expect(calls).toEqual(['validate', 'profile', 'mark']);
    });

    it('does not mark code when validation fails', async () => {
        const deps = {
            validateAccessCode: vi.fn(async () => ({ valid: false, message: 'Code already used' })),
            redeemParentInvite: vi.fn(),
            updateUserProfile: vi.fn(),
            getTeam: vi.fn(),
            getUserProfile: vi.fn(),
            markAccessCodeAsUsed: vi.fn()
        };

        const processInvite = createInviteProcessor(deps);

        await expect(processInvite('user-2', 'ABCD1234')).rejects.toThrow('Code already used');
        expect(deps.markAccessCodeAsUsed).not.toHaveBeenCalled();
    });
});
