import { describe, it, expect, vi } from 'vitest';
import { redeemAdminInviteAcceptance } from '../../js/admin-invite-redemption.js';

describe('admin invite redemption', () => {
    it('persists invited user email to team adminEmails and marks code used', async () => {
        const getTeam = vi.fn().mockResolvedValue({
            id: 'team-1',
            name: 'Blue Rockets',
            adminEmails: ['owner@example.com']
        });
        const getUserProfile = vi.fn().mockResolvedValue({
            email: 'NewAdmin@Example.com',
            coachOf: ['team-9'],
            roles: ['viewer']
        });
        const updateTeam = vi.fn().mockResolvedValue(undefined);
        const updateUserProfile = vi.fn().mockResolvedValue(undefined);
        const markAccessCodeAsUsed = vi.fn().mockResolvedValue(undefined);

        const result = await redeemAdminInviteAcceptance({
            userId: 'user-1',
            validation: {
                type: 'admin_invite',
                codeId: 'code-1',
                data: { teamId: 'team-1' }
            },
            getTeam,
            getUserProfile,
            updateTeam,
            updateUserProfile,
            markAccessCodeAsUsed
        });

        expect(updateTeam).toHaveBeenCalledWith('team-1', {
            adminEmails: ['owner@example.com', 'newadmin@example.com']
        });
        expect(updateUserProfile).toHaveBeenCalledWith('user-1', {
            coachOf: ['team-9', 'team-1'],
            roles: ['viewer', 'coach']
        });
        expect(markAccessCodeAsUsed).toHaveBeenCalledWith('code-1', 'user-1');
        expect(result).toEqual({
            success: true,
            teamId: 'team-1',
            teamName: 'Blue Rockets'
        });
    });

    it('does not write duplicate admin email when user is already an admin', async () => {
        const updateTeam = vi.fn().mockResolvedValue(undefined);

        await redeemAdminInviteAcceptance({
            userId: 'user-1',
            validation: {
                type: 'admin_invite',
                codeId: 'code-2',
                data: { teamId: 'team-1' }
            },
            getTeam: vi.fn().mockResolvedValue({
                id: 'team-1',
                name: 'Blue Rockets',
                adminEmails: ['newadmin@example.com']
            }),
            getUserProfile: vi.fn().mockResolvedValue({
                email: 'newadmin@example.com',
                coachOf: [],
                roles: []
            }),
            updateTeam,
            updateUserProfile: vi.fn().mockResolvedValue(undefined),
            markAccessCodeAsUsed: vi.fn().mockResolvedValue(undefined)
        });

        expect(updateTeam).toHaveBeenCalledWith('team-1', {
            adminEmails: ['newadmin@example.com']
        });
    });
});
