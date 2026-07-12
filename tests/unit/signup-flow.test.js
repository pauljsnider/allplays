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
        redeemFriendInvite: vi.fn().mockResolvedValue(undefined),
        redeemAdminInviteAcceptance: vi.fn().mockResolvedValue(undefined),
        redeemHouseholdInvite: vi.fn().mockResolvedValue(undefined),
        redeemCoParentInvite: vi.fn().mockResolvedValue(undefined),
        updateUserProfile: vi.fn().mockResolvedValue(undefined),
        markAccessCodeAsUsed: vi.fn().mockResolvedValue(undefined),
        rollbackParentInviteRedemption: vi.fn().mockResolvedValue(undefined),
        getTeam: vi.fn().mockResolvedValue({ id: 'team-42', name: 'Blue Rockets' }),
        addTeamAdminEmail: vi.fn().mockResolvedValue(undefined),
        getUserProfile: vi.fn().mockResolvedValue({ email: 'newadmin@example.com' }),
        sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
        signOut: vi.fn().mockResolvedValue(undefined),
        ...overrides
    };
}

describe('executeEmailPasswordSignup', () => {


    it('redeems household invites during email signup instead of generically consuming the code', async () => {
        const dependencies = createDependencies({
            validateAccessCode: vi.fn().mockResolvedValue({
                valid: true,
                type: 'household_invite',
                codeId: 'code-household-1',
                data: { code: 'HOME1234' }
            })
        });
        const auth = {
            currentUser: {
                email: 'household@example.com',
                reload: vi.fn().mockResolvedValue(undefined)
            }
        };

        await executeEmailPasswordSignup({
            email: 'household@example.com',
            password: 'password123',
            activationCode: 'HOME1234',
            auth,
            dependencies
        });

        expect(dependencies.redeemHouseholdInvite).toHaveBeenCalledWith('user-123', 'HOME1234');
        expect(dependencies.markAccessCodeAsUsed).not.toHaveBeenCalled();
        expect(dependencies.updateUserProfile).toHaveBeenCalledTimes(1);
    });

    it('redeems co-parent invites during email signup with the signup email', async () => {
        const dependencies = createDependencies({
            validateAccessCode: vi.fn().mockResolvedValue({
                valid: true,
                type: 'coparent_invite',
                codeId: 'code-coparent-1',
                data: { code: 'COPO1234' }
            })
        });
        const auth = {
            currentUser: {
                email: 'coparent@example.com',
                reload: vi.fn().mockResolvedValue(undefined)
            }
        };

        await executeEmailPasswordSignup({
            email: 'coparent@example.com',
            password: 'password123',
            activationCode: 'COPO1234',
            auth,
            dependencies
        });

        expect(dependencies.redeemCoParentInvite).toHaveBeenCalledWith('user-123', 'COPO1234', 'coparent@example.com');
        expect(dependencies.markAccessCodeAsUsed).not.toHaveBeenCalled();
    });

    it('rolls back signup when parent invite redemption rejects a mismatched email', async () => {
        const mismatchError = new Error('This invite was sent to invited@example.com. Sign in with that email to accept it.');
        const deleteAuthUser = vi.fn().mockResolvedValue(undefined);
        const dependencies = createDependencies({
            createUserWithEmailAndPassword: vi.fn().mockResolvedValue({
                user: {
                    uid: 'user-123',
                    delete: deleteAuthUser
                }
            }),
            redeemParentInvite: vi.fn().mockRejectedValue(mismatchError)
        });
        const auth = { currentUser: null };

        await expect(executeEmailPasswordSignup({
            email: 'attacker@example.com',
            password: 'password123',
            activationCode: 'PARENTCODE',
            auth,
            dependencies
        })).rejects.toThrow('This invite was sent to invited@example.com. Sign in with that email to accept it.');

        expect(dependencies.createUserWithEmailAndPassword).toHaveBeenCalledTimes(1);
        expect(dependencies.redeemParentInvite).toHaveBeenCalledWith('user-123', 'PARENTCODE', 'attacker@example.com');
        expect(dependencies.rollbackParentInviteRedemption).toHaveBeenCalledWith('user-123', 'PARENTCODE');
        expect(deleteAuthUser).toHaveBeenCalledTimes(1);
        expect(dependencies.rollbackParentInviteRedemption.mock.invocationCallOrder[0]).toBeLessThan(deleteAuthUser.mock.invocationCallOrder[0]);
        expect(dependencies.signOut).toHaveBeenCalledWith(auth);
        expect(dependencies.updateUserProfile).not.toHaveBeenCalled();
        expect(dependencies.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('rolls back signup when admin invite redemption rejects a mismatched email', async () => {
        const mismatchError = new Error('This invite was sent to admin@example.com. Sign in with that email to accept it.');
        const deleteAuthUser = vi.fn().mockResolvedValue(undefined);
        const dependencies = createDependencies({
            validateAccessCode: vi.fn().mockResolvedValue({
                valid: true,
                type: 'admin_invite',
                codeId: 'code-admin-3',
                data: {
                    type: 'admin_invite'
                }
            }),
            createUserWithEmailAndPassword: vi.fn().mockResolvedValue({
                user: {
                    uid: 'user-123',
                    delete: deleteAuthUser
                }
            }),
            redeemAdminInviteAcceptance: vi.fn().mockRejectedValue(mismatchError)
        });
        const auth = { currentUser: null };

        await expect(executeEmailPasswordSignup({
            email: 'other@example.com',
            password: 'password123',
            activationCode: 'ADMIN003',
            auth,
            dependencies
        })).rejects.toThrow('This invite was sent to admin@example.com. Sign in with that email to accept it.');

        expect(dependencies.createUserWithEmailAndPassword).toHaveBeenCalledTimes(1);
        expect(dependencies.redeemAdminInviteAcceptance).toHaveBeenCalledTimes(1);
        expect(deleteAuthUser).toHaveBeenCalledTimes(1);
        expect(dependencies.signOut).toHaveBeenCalledWith(auth);
        expect(dependencies.updateUserProfile).not.toHaveBeenCalled();
        expect(dependencies.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('passes the signup email through to parent invite redemption', async () => {
        const dependencies = createDependencies();
        const auth = {
            currentUser: {
                email: 'Invited@Example.com',
                reload: vi.fn().mockResolvedValue(undefined)
            }
        };

        await executeEmailPasswordSignup({
            email: 'Invited@Example.com',
            password: 'password123',
            activationCode: 'PARENTCODE',
            auth,
            dependencies
        });

        expect(dependencies.createUserWithEmailAndPassword).toHaveBeenCalledTimes(1);
        expect(dependencies.redeemParentInvite).toHaveBeenCalledWith('user-123', 'PARENTCODE', 'Invited@Example.com');
    });

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
        expect(dependencies.sendVerificationEmail).not.toHaveBeenCalled();
        expect(dependencies.rollbackParentInviteRedemption).toHaveBeenCalledWith('user-123', 'PARENTCODE');
        expect(deleteAuthUser).toHaveBeenCalledTimes(1);
        expect(dependencies.rollbackParentInviteRedemption.mock.invocationCallOrder[0]).toBeLessThan(deleteAuthUser.mock.invocationCallOrder[0]);
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
        expect(dependencies.sendVerificationEmail).not.toHaveBeenCalled();
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
        expect(dependencies.redeemParentInvite).toHaveBeenCalledWith('user-123', 'PARENTCODE', 'parent@example.com');
        expect(dependencies.updateUserProfile).toHaveBeenCalledTimes(1);
        expect(reload).toHaveBeenCalledTimes(1);
        expect(dependencies.sendVerificationEmail).toHaveBeenCalledTimes(1);
    });

    it('revalidates after account creation when pre-auth validation is generic', async () => {
        const dependencies = createDependencies({
            validateAccessCode: vi.fn()
                .mockResolvedValueOnce({
                    valid: false,
                    message: 'Invalid or expired access code'
                })
                .mockResolvedValueOnce({
                    valid: true,
                    type: 'parent_invite',
                    data: { code: 'PARENTCODE' }
                })
        });
        const reload = vi.fn().mockResolvedValue(undefined);
        const auth = {
            currentUser: {
                email: 'parent@example.com',
                reload
            }
        };

        await executeEmailPasswordSignup({
            email: 'parent@example.com',
            password: 'password123',
            activationCode: 'PARENTCODE',
            auth,
            dependencies
        });

        expect(dependencies.validateAccessCode).toHaveBeenCalledTimes(2);
        expect(dependencies.createUserWithEmailAndPassword).toHaveBeenCalledTimes(1);
        expect(dependencies.redeemParentInvite).toHaveBeenCalledWith('user-123', 'PARENTCODE', 'parent@example.com');
        expect(dependencies.sendVerificationEmail).toHaveBeenCalledTimes(1);
    });

    it('cleans up the auth account when post-auth revalidation still fails', async () => {
        const deleteAuthUser = vi.fn().mockResolvedValue(undefined);
        const dependencies = createDependencies({
            validateAccessCode: vi.fn()
                .mockResolvedValueOnce({
                    valid: false,
                    message: 'Invalid or expired access code'
                })
                .mockResolvedValueOnce({
                    valid: false,
                    message: 'Invalid access code'
                }),
            createUserWithEmailAndPassword: vi.fn().mockResolvedValue({
                user: {
                    uid: 'user-789',
                    delete: deleteAuthUser
                }
            })
        });
        const auth = { currentUser: null };

        await expect(executeEmailPasswordSignup({
            email: 'parent@example.com',
            password: 'password123',
            activationCode: 'PARENTCODE',
            auth,
            dependencies
        })).rejects.toThrow('Invalid access code');

        expect(dependencies.validateAccessCode).toHaveBeenCalledTimes(2);
        expect(deleteAuthUser).toHaveBeenCalledTimes(1);
        expect(dependencies.signOut).toHaveBeenCalledWith(auth);
        expect(dependencies.redeemParentInvite).not.toHaveBeenCalled();
        expect(dependencies.updateUserProfile).not.toHaveBeenCalled();
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
            codeId: 'code-admin-1'
        }));
        expect(dependencies.redeemAdminInviteAcceptance.mock.calls[0][0]).not.toHaveProperty('markAccessCodeAsUsed');
        expect(dependencies.redeemAdminInviteAcceptance.mock.calls[0][0]).not.toHaveProperty('addTeamAdminEmail');
        expect(dependencies.redeemAdminInviteAcceptance.mock.calls[0][0]).not.toHaveProperty('updateUserProfile');
        expect(dependencies.updateUserProfile).toHaveBeenCalledWith('user-123', expect.objectContaining({
            email: 'newadmin@example.com',
            emailVerificationRequired: true
        }));
        expect(dependencies.markAccessCodeAsUsed).not.toHaveBeenCalled();
        expect(dependencies.sendVerificationEmail).toHaveBeenCalledTimes(1);
    });

    it('routes friend invite signup through friend redemption and not generic code consumption', async () => {
        const dependencies = createDependencies({
            validateAccessCode: vi.fn().mockResolvedValue({
                valid: true,
                type: 'friend_invite',
                codeId: 'code-friend-1',
                data: { code: 'FRIEND12' }
            })
        });
        const reload = vi.fn().mockResolvedValue(undefined);
        const auth = {
            currentUser: {
                email: 'friend@example.com',
                reload
            }
        };

        await executeEmailPasswordSignup({
            email: 'friend@example.com',
            password: 'password123',
            activationCode: 'FRIEND12',
            auth,
            dependencies
        });

        expect(dependencies.redeemFriendInvite).toHaveBeenCalledWith('user-123', 'FRIEND12', 'friend@example.com');
        expect(dependencies.markAccessCodeAsUsed).not.toHaveBeenCalled();
        expect(dependencies.updateUserProfile).toHaveBeenCalledWith('user-123', expect.objectContaining({
            email: 'friend@example.com',
            emailVerificationRequired: true
        }));
        expect(dependencies.sendVerificationEmail).toHaveBeenCalledTimes(1);
    });

    it('rolls back auth account and rethrows when friend invite redemption fails', async () => {
        const expectedError = new Error('friend redemption failed');
        const deleteAuthUser = vi.fn().mockResolvedValue(undefined);
        const dependencies = createDependencies({
            validateAccessCode: vi.fn().mockResolvedValue({
                valid: true,
                type: 'friend_invite',
                codeId: 'code-friend-2',
                data: { code: 'FRIEND34' }
            }),
            createUserWithEmailAndPassword: vi.fn().mockResolvedValue({
                user: {
                    uid: 'user-123',
                    delete: deleteAuthUser
                }
            }),
            redeemFriendInvite: vi.fn().mockRejectedValue(expectedError)
        });
        const auth = {
            currentUser: {
                email: 'friend@example.com',
                reload: vi.fn().mockResolvedValue(undefined)
            }
        };

        await expect(executeEmailPasswordSignup({
            email: 'friend@example.com',
            password: 'password123',
            activationCode: 'FRIEND34',
            auth,
            dependencies
        })).rejects.toThrow('friend redemption failed');

        expect(deleteAuthUser).toHaveBeenCalledTimes(1);
        expect(dependencies.signOut).toHaveBeenCalledTimes(1);
        expect(dependencies.updateUserProfile).not.toHaveBeenCalled();
        expect(dependencies.markAccessCodeAsUsed).not.toHaveBeenCalled();
        expect(dependencies.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('rolls back auth account and rethrows when admin invite redemption fails', async () => {
        const expectedError = new Error('admin redemption failed');
        const deleteAuthUser = vi.fn().mockResolvedValue(undefined);
        const dependencies = createDependencies({
            validateAccessCode: vi.fn().mockResolvedValue({
                valid: true,
                type: 'admin_invite',
                codeId: 'code-admin-2',
                data: { teamId: 'team-42' }
            }),
            createUserWithEmailAndPassword: vi.fn().mockResolvedValue({
                user: {
                    uid: 'user-123',
                    delete: deleteAuthUser
                }
            }),
            redeemAdminInviteAcceptance: vi.fn().mockRejectedValue(expectedError)
        });
        const auth = {
            currentUser: {
                email: 'newadmin@example.com',
                reload: vi.fn().mockResolvedValue(undefined)
            }
        };

        await expect(executeEmailPasswordSignup({
            email: 'newadmin@example.com',
            password: 'password123',
            activationCode: 'ADMIN002',
            auth,
            dependencies
        })).rejects.toThrow('admin redemption failed');

        expect(deleteAuthUser).toHaveBeenCalledTimes(1);
        expect(dependencies.signOut).toHaveBeenCalledTimes(1);
        expect(dependencies.updateUserProfile).not.toHaveBeenCalled();
        expect(dependencies.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('fails closed and cleans up when standard access code claim fails', async () => {
        const expectedError = new Error('Code already used');
        const deleteAuthUser = vi.fn().mockResolvedValue(undefined);
        const dependencies = createDependencies({
            validateAccessCode: vi.fn().mockResolvedValue({
                valid: true,
                type: 'standard',
                codeId: 'code-standard-1',
                data: { code: 'STANDARD1' }
            }),
            createUserWithEmailAndPassword: vi.fn().mockResolvedValue({
                user: {
                    uid: 'user-456',
                    delete: deleteAuthUser
                }
            }),
            markAccessCodeAsUsed: vi.fn().mockRejectedValue(expectedError)
        });
        const auth = {
            currentUser: {
                email: 'user@example.com',
                reload: vi.fn().mockResolvedValue(undefined)
            }
        };

        await expect(executeEmailPasswordSignup({
            email: 'user@example.com',
            password: 'password123',
            activationCode: 'STANDARD1',
            auth,
            dependencies
        })).rejects.toThrow('Code already used');

        expect(dependencies.updateUserProfile).not.toHaveBeenCalled();
        expect(dependencies.sendVerificationEmail).not.toHaveBeenCalled();
        expect(deleteAuthUser).toHaveBeenCalledTimes(1);
        expect(dependencies.signOut).toHaveBeenCalledWith(auth);
    });
});
