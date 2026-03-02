import { describe, it, expect, vi } from 'vitest';
import { executeEmailPasswordSignup } from '../../js/signup-flow.js';

function createDependencies(overrides = {}) {
    return {
        validateAccessCode: vi.fn().mockResolvedValue({
            valid: true,
            type: 'parent_invite',
            data: { code: 'PARENTCODE' }
        }),
        createUserWithEmailAndPassword: vi.fn().mockResolvedValue({
            user: {
                uid: 'user-123',
                delete: vi.fn().mockResolvedValue(undefined)
            }
        }),
        redeemParentInvite: vi.fn().mockResolvedValue(undefined),
        redeemAdminInviteAcceptance: vi.fn().mockResolvedValue(undefined),
        updateUserProfile: vi.fn().mockResolvedValue(undefined),
        markAccessCodeAsUsed: vi.fn().mockResolvedValue(undefined),
        getTeam: vi.fn().mockResolvedValue({ id: 'team-42', name: 'Blue Rockets' }),
        addTeamAdminEmail: vi.fn().mockResolvedValue(undefined),
        getUserProfile: vi.fn().mockResolvedValue({ email: 'newadmin@example.com' }),
        sendEmailVerification: vi.fn().mockResolvedValue(undefined),
        signOut: vi.fn().mockResolvedValue(undefined),
        ...overrides
    };
}

describe('executeEmailPasswordSignup', () => {
    it('throws when parent invite linking fails so signup does not report success', async () => {
        const expectedError = new Error('temporary backend failure');
        const deleteAuthUser = vi.fn().mockResolvedValue(undefined);
        const dependencies = createDependencies({
            createUserWithEmailAndPassword: vi.fn().mockResolvedValue({
                user: {
                    uid: 'user-123',
                    delete: deleteAuthUser
                }
            }),
            redeemParentInvite: vi.fn().mockRejectedValue(expectedError)
        });
        const auth = {
            currentUser: {
                email: 'parent@example.com',
                reload: vi.fn().mockResolvedValue(undefined)
            }
        };

        await expect(executeEmailPasswordSignup({
            email: 'parent@example.com',
            password: 'password123',
            activationCode: 'PARENTCODE',
            auth,
            dependencies
        })).rejects.toThrow('temporary backend failure');

        expect(dependencies.updateUserProfile).not.toHaveBeenCalled();
        expect(dependencies.sendEmailVerification).not.toHaveBeenCalled();
        expect(deleteAuthUser).toHaveBeenCalledTimes(1);
        expect(dependencies.signOut).toHaveBeenCalledTimes(1);
        expect(dependencies.signOut).toHaveBeenCalledWith(auth);
    });

    it('still signs out and rethrows original invite error when auth user delete fails', async () => {
        const expectedError = new Error('temporary backend failure');
        const deleteError = new Error('delete failed');
        const deleteAuthUser = vi.fn().mockRejectedValue(deleteError);
        const dependencies = createDependencies({
            createUserWithEmailAndPassword: vi.fn().mockResolvedValue({
                user: {
                    uid: 'user-123',
                    delete: deleteAuthUser
                }
            }),
            redeemParentInvite: vi.fn().mockRejectedValue(expectedError)
        });
        const auth = {
            currentUser: {
                email: 'parent@example.com',
                reload: vi.fn().mockResolvedValue(undefined)
            }
        };

        await expect(executeEmailPasswordSignup({
            email: 'parent@example.com',
            password: 'password123',
            activationCode: 'PARENTCODE',
            auth,
            dependencies
        })).rejects.toThrow('temporary backend failure');

        expect(deleteAuthUser).toHaveBeenCalledTimes(1);
        expect(dependencies.signOut).toHaveBeenCalledTimes(1);
        expect(dependencies.signOut).toHaveBeenCalledWith(auth);
        expect(dependencies.updateUserProfile).not.toHaveBeenCalled();
        expect(dependencies.sendEmailVerification).not.toHaveBeenCalled();
    });

    it('completes parent invite signup and sends verification when linking succeeds', async () => {
        const dependencies = createDependencies();
        const reload = vi.fn().mockResolvedValue(undefined);
        const auth = {
            currentUser: {
                email: 'parent@example.com',
                reload
            }
        };

        const result = await executeEmailPasswordSignup({
            email: 'parent@example.com',
            password: 'password123',
            activationCode: 'PARENTCODE',
            auth,
            dependencies
        });

        expect(result.user.uid).toBe('user-123');
        expect(dependencies.redeemParentInvite).toHaveBeenCalledWith('user-123', 'PARENTCODE');
        expect(dependencies.updateUserProfile).toHaveBeenCalledTimes(1);
        expect(reload).toHaveBeenCalledTimes(1);
        expect(dependencies.sendEmailVerification).toHaveBeenCalledTimes(1);
    });

    it('routes admin invite signup through admin persistence and not generic code consumption', async () => {
        const dependencies = createDependencies({
            validateAccessCode: vi.fn().mockResolvedValue({
                valid: true,
                type: 'admin_invite',
                codeId: 'code-admin-1',
                data: { teamId: 'team-42' }
            })
        });
        const reload = vi.fn().mockResolvedValue(undefined);
        const auth = {
            currentUser: {
                email: 'newadmin@example.com',
                reload
            }
        };

        await executeEmailPasswordSignup({
            email: 'newadmin@example.com',
            password: 'password123',
            activationCode: 'ADMIN001',
            auth,
            dependencies
        });

        expect(dependencies.redeemAdminInviteAcceptance).toHaveBeenCalledWith(expect.objectContaining({
            userId: 'user-123',
            userEmail: 'newadmin@example.com',
            teamId: 'team-42',
            codeId: 'code-admin-1'
        }));
        expect(dependencies.markAccessCodeAsUsed).not.toHaveBeenCalled();
        expect(dependencies.sendEmailVerification).toHaveBeenCalledTimes(1);
    });
});
