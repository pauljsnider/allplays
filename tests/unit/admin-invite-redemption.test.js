import { describe, it, expect, vi } from 'vitest';
import { redeemAdminInviteAcceptance } from '../../js/admin-invite-redemption.js';

describe('admin invite redemption', () => {
    it('persists admin invite acceptance through atomic callback', async () => {
        const getTeam = vi.fn().mockResolvedValue({
            id: 'team-1',
            name: 'Blue Rockets',
            adminEmails: ['owner@example.com']
        });
        const getUserProfile = vi.fn().mockResolvedValue({
            email: 'NewAdmin@Example.com'
        });
        const redeemAdminInviteAtomicPersistence = vi.fn().mockResolvedValue(undefined);

        const result = await redeemAdminInviteAcceptance({
            userId: 'user-1',
            validation: {
                type: 'admin_invite',
                codeId: 'code-1',
                data: { teamId: 'team-1' }
            },
            getTeam,
            getUserProfile,
            redeemAdminInviteAtomicPersistence
        });

        expect(redeemAdminInviteAtomicPersistence).toHaveBeenCalledWith({
            teamId: 'team-1',
            userId: 'user-1',
            userEmail: 'newadmin@example.com',
            codeId: 'code-1'
        });
        expect(result).toEqual({
            success: true,
            teamId: 'team-1',
            teamName: 'Blue Rockets'
        });
    });

    it('normalizes user email before atomic persistence', async () => {
        const redeemAdminInviteAtomicPersistence = vi.fn().mockResolvedValue(undefined);

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
                email: '  NEWADMIN@EXAMPLE.COM  '
            }),
            redeemAdminInviteAtomicPersistence
        });

        expect(redeemAdminInviteAtomicPersistence).toHaveBeenCalledWith({
            teamId: 'team-1',
            userId: 'user-1',
            userEmail: 'newadmin@example.com',
            codeId: 'code-2'
        });
    });

    it('fails closed when atomic persistence callback is missing', async () => {
        await expect(redeemAdminInviteAcceptance({
            userId: 'user-1',
            validation: {
                type: 'admin_invite',
                codeId: 'code-2',
                data: { teamId: 'team-1' }
            },
            getTeam: vi.fn().mockResolvedValue({
                id: 'team-1',
                name: 'Blue Rockets'
            }),
            getUserProfile: vi.fn().mockResolvedValue({
                email: 'newadmin@example.com'
            })
        })).rejects.toThrow('Missing atomic persistence handler for admin invite');
    });
});
