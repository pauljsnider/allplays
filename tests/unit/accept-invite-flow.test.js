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
        const result = await processInvite('user-1', 'ABCD1234');

        expect(result.success).toBe(true);
        expect(result.redirectUrl).toBe('dashboard.html');
        expect(result.message).toContain('Tigers');
        expect(deps.redeemAdminInviteAtomically).toHaveBeenCalledWith('code-123', 'user-1');
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

    it('falls back to profile + team updates when atomic redemption is unavailable', async () => {
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
        await processInvite('user-3', 'IJKL9012');

        expect(deps.updateTeam).toHaveBeenCalledWith('team-3', { adminEmails: ['other@example.com', 'coach@example.com'] });
        expect(deps.updateUserProfile).toHaveBeenCalledWith('user-3', {
            coachOf: ['team-1', 'team-3'],
            roles: ['parent', 'coach']
        });
        expect(deps.markAccessCodeAsUsed).toHaveBeenCalledWith('code-125', 'user-3');
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
