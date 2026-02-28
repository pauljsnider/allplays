import { describe, it, expect, vi, beforeEach } from 'vitest';

const firebaseMocks = vi.hoisted(() => {
    return {
        auth: { currentUser: null },
        signInWithEmailAndPassword: vi.fn(),
        createUserWithEmailAndPassword: vi.fn(),
        signOut: vi.fn(),
        onAuthStateChanged: vi.fn(),
        GoogleAuthProvider: vi.fn(),
        signInWithPopup: vi.fn(),
        signInWithRedirect: vi.fn(),
        getRedirectResult: vi.fn(),
        sendPasswordResetEmail: vi.fn(),
        sendEmailVerification: vi.fn(),
        sendSignInLinkToEmail: vi.fn(),
        isSignInWithEmailLink: vi.fn(),
        signInWithEmailLink: vi.fn(),
        updatePassword: vi.fn()
    };
});

const dbMocks = vi.hoisted(() => {
    return {
        validateAccessCode: vi.fn(),
        markAccessCodeAsUsed: vi.fn(),
        updateUserProfile: vi.fn(),
        redeemParentInvite: vi.fn(),
        getUserProfile: vi.fn(),
        getUserTeams: vi.fn(),
        getUserByEmail: vi.fn()
    };
});

vi.mock('../../js/firebase.js?v=9', () => firebaseMocks);
vi.mock('../../js/db.js?v=14', () => dbMocks);

const { signup, loginWithGoogle } = await import('../../js/auth.js');

describe('signup parent invite flow', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        const sessionStorageState = {};
        vi.stubGlobal('window', {
            sessionStorage: {
                getItem: vi.fn((key) => sessionStorageState[key] ?? null),
                setItem: vi.fn((key, value) => {
                    sessionStorageState[key] = String(value);
                }),
                removeItem: vi.fn((key) => {
                    delete sessionStorageState[key];
                })
            }
        });
    });

    it('rejects when parent invite linking fails', async () => {
        dbMocks.validateAccessCode.mockResolvedValue({
            valid: true,
            type: 'parent_invite',
            data: { code: 'PARENT1' }
        });
        const deleteMock = vi.fn().mockResolvedValue();
        firebaseMocks.createUserWithEmailAndPassword.mockResolvedValue({
            user: { uid: 'user-1', delete: deleteMock }
        });
        dbMocks.redeemParentInvite.mockRejectedValue(new Error('Team or Player not found'));

        await expect(signup('parent@example.com', 'password123', 'PARENT1')).rejects.toThrow('Team or Player not found');
        expect(dbMocks.redeemParentInvite).toHaveBeenCalledWith('user-1', 'PARENT1');
        expect(deleteMock).toHaveBeenCalledTimes(1);
        expect(firebaseMocks.signOut).toHaveBeenCalledTimes(1);
        expect(dbMocks.markAccessCodeAsUsed).not.toHaveBeenCalled();
        expect(dbMocks.updateUserProfile).not.toHaveBeenCalled();
    });

    it('rejects google signup when parent invite linking fails', async () => {
        dbMocks.validateAccessCode.mockResolvedValue({
            valid: true,
            type: 'parent_invite',
            data: { code: 'PARENT1' }
        });
        const deleteMock = vi.fn().mockResolvedValue();
        firebaseMocks.signInWithPopup.mockResolvedValue({
            user: {
                uid: 'google-user-1',
                email: 'parent@example.com',
                displayName: 'Parent',
                photoURL: 'https://example.com/photo.png',
                metadata: {
                    creationTime: '2026-02-28T00:00:00.000Z',
                    lastSignInTime: '2026-02-28T00:00:00.000Z'
                },
                delete: deleteMock
            }
        });
        dbMocks.redeemParentInvite.mockRejectedValue(new Error('Team or Player not found'));

        await expect(loginWithGoogle('PARENT1')).rejects.toThrow('Team or Player not found');
        expect(dbMocks.redeemParentInvite).toHaveBeenCalledWith('google-user-1', 'PARENT1');
        expect(deleteMock).toHaveBeenCalledTimes(1);
        expect(firebaseMocks.signOut).toHaveBeenCalledTimes(1);
        expect(dbMocks.markAccessCodeAsUsed).not.toHaveBeenCalled();
        expect(dbMocks.updateUserProfile).not.toHaveBeenCalled();
    });

    it('does not fail signup when parent invite profile write fails after redeem', async () => {
        dbMocks.validateAccessCode.mockResolvedValue({
            valid: true,
            type: 'parent_invite',
            data: { code: 'PARENT1' }
        });
        firebaseMocks.createUserWithEmailAndPassword.mockResolvedValue({
            user: { uid: 'user-3', delete: vi.fn().mockResolvedValue() }
        });
        dbMocks.redeemParentInvite.mockResolvedValue();
        dbMocks.updateUserProfile.mockRejectedValue(new Error('Firestore unavailable'));

        await expect(signup('parent2@example.com', 'password123', 'PARENT1')).resolves.toEqual({
            user: { uid: 'user-3', delete: expect.any(Function) }
        });
        expect(dbMocks.redeemParentInvite).toHaveBeenCalledWith('user-3', 'PARENT1');
        expect(firebaseMocks.signOut).not.toHaveBeenCalled();
    });

    it('does not fail google signup when parent invite profile write fails after redeem', async () => {
        dbMocks.validateAccessCode.mockResolvedValue({
            valid: true,
            type: 'parent_invite',
            data: { code: 'PARENT1' }
        });
        const deleteMock = vi.fn().mockResolvedValue();
        firebaseMocks.signInWithPopup.mockResolvedValue({
            user: {
                uid: 'google-user-2',
                email: 'parent2@example.com',
                displayName: 'Parent Two',
                photoURL: 'https://example.com/photo2.png',
                metadata: {
                    creationTime: '2026-02-28T00:00:00.000Z',
                    lastSignInTime: '2026-02-28T00:00:00.000Z'
                },
                delete: deleteMock
            }
        });
        dbMocks.redeemParentInvite.mockResolvedValue();
        dbMocks.updateUserProfile.mockRejectedValue(new Error('Firestore unavailable'));

        await expect(loginWithGoogle('PARENT1')).resolves.toMatchObject({
            user: { uid: 'google-user-2' }
        });
        expect(dbMocks.redeemParentInvite).toHaveBeenCalledWith('google-user-2', 'PARENT1');
        expect(deleteMock).not.toHaveBeenCalled();
        expect(firebaseMocks.signOut).not.toHaveBeenCalled();
    });

    it('continues to support standard activation code signup', async () => {
        dbMocks.validateAccessCode.mockResolvedValue({
            valid: true,
            type: 'coach',
            codeId: 'code-1'
        });
        dbMocks.updateUserProfile.mockResolvedValue();
        firebaseMocks.createUserWithEmailAndPassword.mockResolvedValue({
            user: { uid: 'user-2' }
        });

        await expect(signup('coach@example.com', 'password123', 'COACH1')).resolves.toEqual({
            user: { uid: 'user-2' }
        });

        expect(dbMocks.markAccessCodeAsUsed).toHaveBeenCalledWith('code-1', 'user-2');
    });
});
