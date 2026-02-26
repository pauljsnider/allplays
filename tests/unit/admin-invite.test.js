import { describe, it, expect, vi } from 'vitest';
import { redeemAdminInviteAcceptance } from '../../js/admin-invite.js';

describe('admin invite acceptance', () => {
    it('persists team admin email, merges profile access, and marks code used', async () => {
        const getTeam = vi.fn().mockResolvedValue({ id: 'team-1', name: 'Sharks' });
        const addTeamAdminEmail = vi.fn().mockResolvedValue(undefined);
        const getUserProfile = vi.fn().mockResolvedValue({ coachOf: ['team-0'], roles: ['parent'] });
        const updateUserProfile = vi.fn().mockResolvedValue(undefined);
        const markAccessCodeAsUsed = vi.fn().mockResolvedValue(undefined);

        const team = await redeemAdminInviteAcceptance({
            userId: 'user-1',
            userEmail: 'Admin@Example.com',
            teamId: 'team-1',
            codeId: 'code-1',
            markAccessCodeAsUsed,
            getTeam,
            addTeamAdminEmail,
            getUserProfile,
            updateUserProfile
        });

        expect(team).toEqual({ id: 'team-1', name: 'Sharks' });
        expect(addTeamAdminEmail).toHaveBeenCalledWith('team-1', 'Admin@Example.com');
        expect(updateUserProfile).toHaveBeenCalledWith('user-1', {
            coachOf: ['team-0', 'team-1'],
            roles: ['parent', 'coach']
        });
        expect(updateUserProfile.mock.invocationCallOrder[0]).toBeLessThan(addTeamAdminEmail.mock.invocationCallOrder[0]);
        expect(markAccessCodeAsUsed).toHaveBeenCalledWith('code-1', 'user-1');
    });

    it('throws when team is missing', async () => {
        await expect(
            redeemAdminInviteAcceptance({
                userId: 'user-1',
                userEmail: 'admin@example.com',
                teamId: 'missing-team',
                codeId: 'code-1',
                markAccessCodeAsUsed: vi.fn(),
                getTeam: vi.fn().mockResolvedValue(null),
                addTeamAdminEmail: vi.fn(),
                getUserProfile: vi.fn().mockResolvedValue(null),
                updateUserProfile: vi.fn()
            })
        ).rejects.toThrow('Team not found');
    });

    it('skips code mark when codeId is absent', async () => {
        const markAccessCodeAsUsed = vi.fn();

        await redeemAdminInviteAcceptance({
            userId: 'user-1',
            userEmail: 'admin@example.com',
            teamId: 'team-1',
            markAccessCodeAsUsed,
            getTeam: vi.fn().mockResolvedValue({ id: 'team-1' }),
            addTeamAdminEmail: vi.fn().mockResolvedValue(undefined),
            getUserProfile: vi.fn().mockResolvedValue({ coachOf: ['team-1'], roles: ['coach'] }),
            updateUserProfile: vi.fn().mockResolvedValue(undefined)
        });

        expect(markAccessCodeAsUsed).not.toHaveBeenCalled();
    });
});
