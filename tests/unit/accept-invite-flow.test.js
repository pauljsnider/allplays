import { describe, it, expect, vi } from 'vitest';
import { processInviteCode } from '../../js/accept-invite-flow.js';

describe('accept invite flow', () => {
    it('marks admin invite codes as used after successful redemption', async () => {
        const deps = {
            validateAccessCode: vi.fn().mockResolvedValue({
                valid: true,
                codeId: 'code-1',
                type: 'admin_invite',
                data: { teamId: 'team-1' }
            }),
            redeemParentInvite: vi.fn(),
            updateUserProfile: vi.fn().mockResolvedValue(undefined),
            updateTeam: vi.fn().mockResolvedValue(undefined),
            getTeam: vi.fn().mockResolvedValue({ id: 'team-1', name: 'Tigers', adminEmails: [] }),
            getUserProfile: vi.fn().mockResolvedValue({ email: 'coach@example.com' }),
            markAccessCodeAsUsed: vi.fn().mockResolvedValue(undefined)
        };

        const result = await processInviteCode('user-1', 'ABCD1234', deps);

        expect(result.redirectUrl).toBe('dashboard.html');
        expect(deps.updateUserProfile).toHaveBeenCalledWith('user-1', {
            coachOf: ['team-1'],
            roles: ['coach']
        });
        expect(deps.updateTeam).toHaveBeenCalledWith('team-1', {
            adminEmails: ['coach@example.com']
        });
        expect(deps.markAccessCodeAsUsed).toHaveBeenCalledWith('code-1', 'user-1');
    });

    it('does not update team adminEmails when email already exists', async () => {
        const deps = {
            validateAccessCode: vi.fn().mockResolvedValue({
                valid: true,
                codeId: 'code-1',
                type: 'admin_invite',
                data: { teamId: 'team-1' }
            }),
            redeemParentInvite: vi.fn(),
            updateUserProfile: vi.fn().mockResolvedValue(undefined),
            updateTeam: vi.fn().mockResolvedValue(undefined),
            getTeam: vi.fn().mockResolvedValue({ id: 'team-1', name: 'Tigers', adminEmails: ['coach@example.com'] }),
            getUserProfile: vi.fn().mockResolvedValue({ email: 'COACH@example.com' }),
            markAccessCodeAsUsed: vi.fn().mockResolvedValue(undefined)
        };

        await processInviteCode('user-1', 'ABCD1234', deps);

        expect(deps.updateTeam).not.toHaveBeenCalled();
    });
});
