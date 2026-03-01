import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const signInWithPopupMock = vi.fn();
const signOutMock = vi.fn();
const signInWithRedirectMock = vi.fn();
const getRedirectResultMock = vi.fn();
const validateAccessCodeMock = vi.fn();
const redeemParentInviteMock = vi.fn();
const updateUserProfileMock = vi.fn();
const markAccessCodeAsUsedMock = vi.fn();

vi.mock('../../js/firebase.js?v=9', () => ({
    auth: { currentUser: null },
    signInWithEmailAndPassword: vi.fn(),
    createUserWithEmailAndPassword: vi.fn(),
    signOut: signOutMock,
    onAuthStateChanged: vi.fn(),
    GoogleAuthProvider: class MockGoogleAuthProvider {},
    signInWithPopup: signInWithPopupMock,
    signInWithRedirect: signInWithRedirectMock,
    getRedirectResult: getRedirectResultMock,
    sendPasswordResetEmail: vi.fn(),
    sendEmailVerification: vi.fn(),
    sendSignInLinkToEmail: vi.fn(),
    isSignInWithEmailLink: vi.fn(),
    signInWithEmailLink: vi.fn(),
    updatePassword: vi.fn()
}));

vi.mock('../../js/db.js?v=14', () => ({
    validateAccessCode: validateAccessCodeMock,
    markAccessCodeAsUsed: markAccessCodeAsUsedMock,
    updateUserProfile: updateUserProfileMock,
    redeemParentInvite: redeemParentInviteMock,
    getUserProfile: vi.fn(),
    getUserTeams: vi.fn(),
    getUserByEmail: vi.fn()
}));

describe('loginWithGoogle parent invite failure cleanup', () => {
    let sessionStorageMock;

    beforeEach(() => {
        vi.clearAllMocks();

        sessionStorageMock = {
            setItem: vi.fn(),
            getItem: vi.fn(),
            removeItem: vi.fn()
        };

        vi.stubGlobal('window', {
            sessionStorage: sessionStorageMock
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('deletes auth user, signs out, and rethrows when parent invite linking fails', async () => {
        const expectedError = new Error('parent invite link failed');
        const deleteMock = vi.fn().mockResolvedValue(undefined);
        const result = {
            user: {
                uid: 'user-123',
                email: 'parent@example.com',
                displayName: 'Parent User',
                photoURL: 'https://example.com/photo.png',
                metadata: {
                    creationTime: '2026-03-01T11:00:00.000Z',
                    lastSignInTime: '2026-03-01T11:00:00.000Z'
                },
                delete: deleteMock
            }
        };

        signInWithPopupMock.mockResolvedValue(result);
        validateAccessCodeMock.mockResolvedValue({
            valid: true,
            type: 'parent_invite',
            data: { code: 'PARENTCODE' }
        });
        redeemParentInviteMock.mockRejectedValue(expectedError);
        signOutMock.mockResolvedValue(undefined);

        const { loginWithGoogle } = await import('../../js/auth.js');

        await expect(loginWithGoogle('PARENTCODE')).rejects.toThrow('parent invite link failed');

        expect(redeemParentInviteMock).toHaveBeenCalledWith('user-123', 'PARENTCODE');
        expect(updateUserProfileMock).not.toHaveBeenCalled();
        expect(markAccessCodeAsUsedMock).not.toHaveBeenCalled();
        expect(deleteMock).toHaveBeenCalledTimes(1);
        expect(signOutMock).toHaveBeenCalledTimes(1);
        expect(sessionStorageMock.removeItem).toHaveBeenCalledWith('pendingActivationCode');
    });

    it('signs out and rethrows original invite error when delete fails', async () => {
        const expectedError = new Error('parent invite link failed');
        const deleteFailure = new Error('delete failed');
        const deleteMock = vi.fn().mockRejectedValue(deleteFailure);
        const result = {
            user: {
                uid: 'user-123',
                email: 'parent@example.com',
                displayName: 'Parent User',
                photoURL: 'https://example.com/photo.png',
                metadata: {
                    creationTime: '2026-03-01T11:00:00.000Z',
                    lastSignInTime: '2026-03-01T11:00:00.000Z'
                },
                delete: deleteMock
            }
        };

        signInWithPopupMock.mockResolvedValue(result);
        validateAccessCodeMock.mockResolvedValue({
            valid: true,
            type: 'parent_invite',
            data: { code: 'PARENTCODE' }
        });
        redeemParentInviteMock.mockRejectedValue(expectedError);
        signOutMock.mockResolvedValue(undefined);

        const { loginWithGoogle } = await import('../../js/auth.js');

        await expect(loginWithGoogle('PARENTCODE')).rejects.toThrow('parent invite link failed');

        expect(deleteMock).toHaveBeenCalledTimes(1);
        expect(signOutMock).toHaveBeenCalledTimes(1);
        expect(sessionStorageMock.removeItem).toHaveBeenCalledWith('pendingActivationCode');
    });

    it('applies the same fail-closed cleanup behavior for redirect Google auth', async () => {
        const expectedError = new Error('parent invite link failed');
        const deleteMock = vi.fn().mockResolvedValue(undefined);
        const result = {
            user: {
                uid: 'user-123',
                email: 'parent@example.com',
                displayName: 'Parent User',
                photoURL: 'https://example.com/photo.png',
                metadata: {
                    creationTime: '2026-03-01T11:00:00.000Z',
                    lastSignInTime: '2026-03-01T11:00:00.000Z'
                },
                delete: deleteMock
            }
        };

        getRedirectResultMock.mockResolvedValue(result);
        sessionStorageMock.getItem.mockReturnValue('PARENTCODE');
        validateAccessCodeMock.mockResolvedValue({
            valid: true,
            type: 'parent_invite',
            data: { code: 'PARENTCODE' }
        });
        redeemParentInviteMock.mockRejectedValue(expectedError);
        signOutMock.mockResolvedValue(undefined);

        const { handleGoogleRedirectResult } = await import('../../js/auth.js');

        await expect(handleGoogleRedirectResult()).rejects.toThrow('parent invite link failed');

        expect(redeemParentInviteMock).toHaveBeenCalledWith('user-123', 'PARENTCODE');
        expect(updateUserProfileMock).not.toHaveBeenCalled();
        expect(markAccessCodeAsUsedMock).not.toHaveBeenCalled();
        expect(deleteMock).toHaveBeenCalledTimes(1);
        expect(signOutMock).toHaveBeenCalledTimes(1);
        expect(sessionStorageMock.removeItem).toHaveBeenCalledWith('pendingActivationCode');
    });
});
