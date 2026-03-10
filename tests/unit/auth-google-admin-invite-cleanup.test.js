import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const signInWithPopupMock = vi.fn();
const signOutMock = vi.fn();
const signInWithRedirectMock = vi.fn();
const getRedirectResultMock = vi.fn();
const validateAccessCodeMock = vi.fn();
const updateUserProfileMock = vi.fn();
const markAccessCodeAsUsedMock = vi.fn();
const redeemAdminInviteAcceptanceMock = vi.fn();

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
    redeemParentInvite: vi.fn(),
    getUserProfile: vi.fn(),
    getUserTeams: vi.fn(),
    getUserByEmail: vi.fn(),
    getTeam: vi.fn(),
    addTeamAdminEmail: vi.fn()
}));

vi.mock('../../js/admin-invite.js?v=3', () => ({
    redeemAdminInviteAcceptance: redeemAdminInviteAcceptanceMock
}));

describe('loginWithGoogle admin invite failure handling', () => {
    let sessionStorageMock;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();

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

    it('deletes auth user, signs out, and rethrows when popup admin invite redemption fails', async () => {
        const expectedError = new Error('admin invite redemption failed');
        const deleteMock = vi.fn().mockResolvedValue(undefined);

        signInWithPopupMock.mockResolvedValue({
            user: {
                uid: 'user-123',
                email: 'coach@example.com',
                displayName: 'Coach User',
                photoURL: 'https://example.com/photo.png',
                metadata: {
                    creationTime: '2026-03-07T14:00:00.000Z',
                    lastSignInTime: '2026-03-07T14:00:00.000Z'
                },
                delete: deleteMock
            }
        });
        validateAccessCodeMock.mockResolvedValue({
            valid: true,
            type: 'admin_invite',
            codeId: 'code-admin-1',
            data: { teamId: 'team-1' }
        });
        redeemAdminInviteAcceptanceMock.mockRejectedValue(expectedError);
        signOutMock.mockResolvedValue(undefined);

        const { loginWithGoogle } = await import('../../js/auth.js');

        await expect(loginWithGoogle('ADMINCODE')).rejects.toThrow('admin invite redemption failed');

        expect(redeemAdminInviteAcceptanceMock).toHaveBeenCalledWith(expect.objectContaining({
            userId: 'user-123',
            userEmail: 'coach@example.com',
            teamId: 'team-1',
            codeId: 'code-admin-1'
        }));
        expect(updateUserProfileMock).not.toHaveBeenCalled();
        expect(markAccessCodeAsUsedMock).not.toHaveBeenCalled();
        expect(deleteMock).toHaveBeenCalledTimes(1);
        expect(signOutMock).toHaveBeenCalledTimes(1);
        expect(sessionStorageMock.removeItem).toHaveBeenCalledWith('pendingActivationCode');
    });

    it('applies the same fail-closed cleanup behavior for redirect admin invite auth', async () => {
        const expectedError = new Error('admin invite redemption failed');
        const deleteMock = vi.fn().mockResolvedValue(undefined);

        getRedirectResultMock.mockResolvedValue({
            user: {
                uid: 'user-123',
                email: 'coach@example.com',
                displayName: 'Coach User',
                photoURL: 'https://example.com/photo.png',
                metadata: {
                    creationTime: '2026-03-07T14:00:00.000Z',
                    lastSignInTime: '2026-03-07T14:00:00.000Z'
                },
                delete: deleteMock
            }
        });
        sessionStorageMock.getItem.mockReturnValue('ADMINCODE');
        validateAccessCodeMock.mockResolvedValue({
            valid: true,
            type: 'admin_invite',
            codeId: 'code-admin-2',
            data: { teamId: 'team-2' }
        });
        redeemAdminInviteAcceptanceMock.mockRejectedValue(expectedError);
        signOutMock.mockResolvedValue(undefined);

        const { handleGoogleRedirectResult } = await import('../../js/auth.js');

        await expect(handleGoogleRedirectResult()).rejects.toThrow('admin invite redemption failed');

        expect(redeemAdminInviteAcceptanceMock).toHaveBeenCalledWith(expect.objectContaining({
            userId: 'user-123',
            userEmail: 'coach@example.com',
            teamId: 'team-2',
            codeId: 'code-admin-2'
        }));
        expect(updateUserProfileMock).not.toHaveBeenCalled();
        expect(markAccessCodeAsUsedMock).not.toHaveBeenCalled();
        expect(deleteMock).toHaveBeenCalledTimes(1);
        expect(signOutMock).toHaveBeenCalledTimes(1);
        expect(sessionStorageMock.removeItem).toHaveBeenCalledWith('pendingActivationCode');
    });

    it('does not clean up after successful admin redemption when profile finalization fails', async () => {
        const deleteMock = vi.fn().mockResolvedValue(undefined);

        signInWithPopupMock.mockResolvedValue({
            user: {
                uid: 'user-456',
                email: 'coach2@example.com',
                displayName: 'Coach Two',
                photoURL: 'https://example.com/photo2.png',
                metadata: {
                    creationTime: '2026-03-07T14:00:00.000Z',
                    lastSignInTime: '2026-03-07T14:00:00.000Z'
                },
                delete: deleteMock
            }
        });
        validateAccessCodeMock.mockResolvedValue({
            valid: true,
            type: 'admin_invite',
            codeId: 'code-admin-3',
            data: { teamId: 'team-3' }
        });
        redeemAdminInviteAcceptanceMock.mockResolvedValue(undefined);
        updateUserProfileMock.mockRejectedValue(new Error('profile write failed'));

        const { loginWithGoogle } = await import('../../js/auth.js');

        await expect(loginWithGoogle('ADMINCODE')).resolves.toMatchObject({
            user: { uid: 'user-456' }
        });

        expect(redeemAdminInviteAcceptanceMock).toHaveBeenCalledTimes(1);
        expect(updateUserProfileMock).toHaveBeenCalledTimes(1);
        expect(deleteMock).not.toHaveBeenCalled();
        expect(signOutMock).not.toHaveBeenCalled();
        expect(sessionStorageMock.removeItem).toHaveBeenCalledWith('pendingActivationCode');
    });
});
