import { describe, it, expect, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
    redeemAdminInviteAtomicPersistence: vi.fn()
}));

vi.mock('../../js/db.js?v=53', () => dbMocks);

const { redeemAdminInviteAcceptance } = await import('../../js/admin-invite.js');

describe('admin invite acceptance', () => {
    it('delegates signup admin redemption to atomic persistence', async () => {
        const getTeam = vi.fn().mockResolvedValue({ id: 'team-1', name: 'Sharks' });
        const getUserProfile = vi.fn().mockResolvedValue({ coachOf: ['team-0'], roles: ['parent'] });
        const redeemAdminInviteAtomicPersistence = dbMocks.redeemAdminInviteAtomicPersistence.mockResolvedValue({
            success: true,
            teamId: 'team-1'
        });

        const team = await redeemAdminInviteAcceptance({
            userId: 'user-1',
            userEmail: 'Admin@Example.com',
            codeId: 'code-1',
            getTeam,
            getUserProfile,
            redeemAdminInviteAtomicPersistence
        });

        expect(team).toEqual({ id: 'team-1', name: 'Sharks' });
        expect(redeemAdminInviteAtomicPersistence).toHaveBeenCalledWith({
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
                codeId: 'code-1',
                getTeam: vi.fn().mockResolvedValue(null),
                getUserProfile: vi.fn().mockResolvedValue(null),
                redeemAdminInviteAtomicPersistence: vi.fn().mockResolvedValue({ success: true, teamId: 'missing-team' })
            })
        ).rejects.toThrow('Team not found');
    });

    it('throws when atomic persistence returns no result', async () => {
        await expect(
            redeemAdminInviteAcceptance({
                userId: 'user-1',
                userEmail: 'admin@example.com',
                codeId: 'code-1',
                getTeam: vi.fn().mockResolvedValue({ id: 'team-1', name: 'Sharks' }),
                getUserProfile: vi.fn().mockResolvedValue(null),
                redeemAdminInviteAtomicPersistence: vi.fn().mockResolvedValue(null)
            })
        ).rejects.toThrow('Admin invite redemption returned no result');
    });

    it('fails closed when codeId is absent', async () => {
        await expect(
            redeemAdminInviteAcceptance({
                userId: 'user-1',
                userEmail: 'admin@example.com',
                getTeam: vi.fn().mockResolvedValue({ id: 'team-1' }),
                getUserProfile: vi.fn().mockResolvedValue({ coachOf: ['team-1'], roles: ['coach'] }),
                redeemAdminInviteAtomicPersistence: vi.fn().mockResolvedValue({ success: true, teamId: 'team-1' })
            })
        ).rejects.toThrow('Missing codeId');
    });

    it('fails closed when atomic persistence handler is missing', async () => {

        await expect(
            redeemAdminInviteAcceptance({
                userId: 'user-1',
                userEmail: 'admin@example.com',
                codeId: 'code-1',
                getTeam: vi.fn().mockResolvedValue({ id: 'team-1', name: 'Sharks' }),
                getUserProfile: vi.fn().mockResolvedValue({ coachOf: [], roles: [] }),
                redeemAdminInviteAtomicPersistence: null
            })
        ).rejects.toThrow('Missing atomic admin invite persistence handler');
    });
});
