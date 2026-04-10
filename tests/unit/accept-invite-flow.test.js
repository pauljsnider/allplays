import { describe, it, expect, vi } from 'vitest';
import { createInviteProcessor } from '../../js/accept-invite-flow.js';

describe('accept invite flow', () => {
    it('redeems admin invite codes via atomic redemption when available', async () => {
        const deps = {
            validateAccessCode: vi.fn(async () => ({
                valid: true,
                codeId: 'code-123',
                type: 'admin_invite',
                data: { teamId: 'team-1' }
            })),
            redeemParentInvite: vi.fn(),
            getTeam: vi.fn(),
            redeemAdminInviteAtomically: vi.fn().mockResolvedValue({
                success: true,
                teamId: 'team-1',
                teamName: 'Tigers'
            })
        };

        const processInvite = createInviteProcessor(deps);
        const result = await processInvite('user-1', 'ABCD1234', 'Coach@Example.com');

        expect(result.success).toBe(true);
        expect(result.redirectUrl).toBe('dashboard.html');
        expect(result.message).toContain('Tigers');
        expect(deps.redeemAdminInviteAtomically).toHaveBeenCalledWith('code-123', 'user-1', 'Coach@Example.com');
    });

    it('bubbles atomic admin redemption errors', async () => {
        const deps = {
            validateAccessCode: vi.fn(async () => ({
                valid: true,
                codeId: 'code-124',
                type: 'admin_invite',
                data: { teamId: 'team-2' }
            })),
            redeemParentInvite: vi.fn(),
            getTeam: vi.fn(),
            redeemAdminInviteAtomically: vi.fn().mockRejectedValue(new Error('Code already used'))
        };

        const processInvite = createInviteProcessor(deps);

        await expect(processInvite('user-1', 'ABCD1234')).rejects.toThrow('Code already used');
    });

    it('fails when atomic admin redemption returns an invalid result', async () => {
        const deps = {
            validateAccessCode: vi.fn(async () => ({
                valid: true,
                codeId: 'code-126',
                type: 'admin_invite',
                data: { teamId: 'team-4' }
            })),
            redeemParentInvite: vi.fn(),
            getTeam: vi.fn(),
            redeemAdminInviteAtomically: vi.fn().mockResolvedValue({})
        };

        const processInvite = createInviteProcessor(deps);

        await expect(processInvite('user-4', 'MNOP3456')).rejects.toThrow(
            'Failed to redeem admin invite atomically'
        );
    });

    it('fails closed when atomic admin redemption is unavailable', async () => {
        const deps = {
            validateAccessCode: vi.fn(async () => ({
                valid: true,
                codeId: 'code-125',
                type: 'admin_invite',
                data: { teamId: 'team-3' }
            })),
            redeemParentInvite: vi.fn(),
            updateUserProfile: vi.fn(),
            updateTeam: vi.fn(),
            getTeam: vi.fn(async () => ({ id: 'team-3', name: 'Eagles', adminEmails: ['other@example.com'] })),
            getUserProfile: vi.fn(async () => ({
                email: 'Coach@Example.com',
                coachOf: ['team-1'],
                roles: ['parent']
            })),
            markAccessCodeAsUsed: vi.fn()
        };

        const processInvite = createInviteProcessor(deps);
        await expect(processInvite('user-3', 'IJKL9012')).rejects.toThrow(
            'Missing atomic admin invite redemption handler'
        );

        expect(deps.updateTeam).not.toHaveBeenCalled();
        expect(deps.updateUserProfile).not.toHaveBeenCalled();
        expect(deps.markAccessCodeAsUsed).not.toHaveBeenCalled();
    });

    it('does not mark code when validation fails', async () => {
        const deps = {
            validateAccessCode: vi.fn(async () => ({ valid: false, message: 'Code already used' })),
            redeemParentInvite: vi.fn(),
            markAccessCodeAsUsed: vi.fn()
        };

        const processInvite = createInviteProcessor(deps);

        await expect(processInvite('user-2', 'ABCD1234')).rejects.toThrow('Code already used');
        expect(deps.markAccessCodeAsUsed).not.toHaveBeenCalled();
    });
});
