import { describe, it, expect, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
    functions: {},
    httpsCallable: vi.fn()
}));

vi.mock('../../js/firebase.js?v=22', () => firebaseMocks);

const { redeemAdminInviteAcceptance, redeemAdminInviteAtomically } = await import('../../js/admin-invite.js');

describe('admin invite acceptance', () => {
    it('routes direct admin invite redemption through the server callable', async () => {
        const callable = vi.fn().mockResolvedValue({
            data: {
                success: true,
                teamId: 'team-1',
                teamName: 'Sharks'
            }
        });
        firebaseMocks.httpsCallable.mockReturnValue(callable);

        const result = await redeemAdminInviteAtomically('code-1', 'user-1', 'Admin@Example.com');

        expect(firebaseMocks.httpsCallable).toHaveBeenCalledWith(firebaseMocks.functions, 'redeemAdminInvite');
        expect(callable).toHaveBeenCalledWith({
            userId: 'user-1',
            userEmail: 'Admin@Example.com',
            codeId: 'code-1'
        });
        expect(result).toEqual({
            success: true,
            teamId: 'team-1',
            teamName: 'Sharks'
        });
    });

    it('delegates signup admin redemption to atomic persistence', async () => {
        const getTeam = vi.fn().mockResolvedValue({ id: 'team-1', name: 'Sharks' });
        const getUserProfile = vi.fn().mockResolvedValue({ coachOf: ['team-0'], roles: ['parent'] });
        const redeemAdminInviteAtomicPersistence = vi.fn().mockResolvedValue({
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
