import { describe, it, expect, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
    redeemAdminInviteAtomicPersistence: vi.fn()
}));

vi.mock('../../js/db.js?v=16', () => dbMocks);

const { redeemAdminInviteAcceptance } = await import('../../js/admin-invite.js');

describe('admin invite acceptance', () => {
    it('delegates signup admin redemption to atomic persistence', async () => {
        const getTeam = vi.fn().mockResolvedValue({ id: 'team-1', name: 'Sharks' });
        const getUserProfile = vi.fn().mockResolvedValue({ coachOf: ['team-0'], roles: ['parent'] });
        const redeemAdminInviteAtomicPersistence = dbMocks.redeemAdminInviteAtomicPersistence.mockResolvedValue(undefined);

        const team = await redeemAdminInviteAcceptance({
            userId: 'user-1',
            userEmail: 'Admin@Example.com',
            teamId: 'team-1',
            codeId: 'code-1',
            getTeam,
            getUserProfile,
            redeemAdminInviteAtomicPersistence
        });

        expect(team).toEqual({ id: 'team-1', name: 'Sharks' });
        expect(redeemAdminInviteAtomicPersistence).toHaveBeenCalledWith({
            teamId: 'team-1',
            userId: 'user-1',
            userEmail: 'admin@example.com',
            codeId: 'code-1'
        });
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

    it('fails closed when codeId is absent', async () => {
        await expect(
            redeemAdminInviteAcceptance({
                userId: 'user-1',
                userEmail: 'admin@example.com',
                teamId: 'team-1',
                getTeam: vi.fn().mockResolvedValue({ id: 'team-1' }),
                getUserProfile: vi.fn().mockResolvedValue({ coachOf: ['team-1'], roles: ['coach'] }),
                redeemAdminInviteAtomicPersistence: vi.fn().mockResolvedValue(undefined)
            })
        ).rejects.toThrow('Missing codeId');
    });

    it('fails closed when atomic persistence handler is missing', async () => {

        await expect(
            redeemAdminInviteAcceptance({
                userId: 'user-1',
                userEmail: 'admin@example.com',
                teamId: 'team-1',
                codeId: 'code-1',
                getTeam: vi.fn().mockResolvedValue({ id: 'team-1', name: 'Sharks' }),
                getUserProfile: vi.fn().mockResolvedValue({ coachOf: [], roles: [] }),
                redeemAdminInviteAtomicPersistence: null
            })
        ).rejects.toThrow('Missing atomic admin invite persistence handler');
    });
});
