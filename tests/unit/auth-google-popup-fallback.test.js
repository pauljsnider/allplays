import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const signInWithPopupMock = vi.fn();
const signInWithRedirectMock = vi.fn();
const getRedirectResultMock = vi.fn();
const validateAccessCodeMock = vi.fn();
const markAccessCodeAsUsedMock = vi.fn();

vi.mock('../../js/firebase.js?v=22', () => ({
    auth: { currentUser: null },
    signInWithEmailAndPassword: vi.fn(),
    createUserWithEmailAndPassword: vi.fn(),
    signOut: vi.fn(),
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

vi.mock('../../js/db.js?v=102', () => ({
    validateAccessCode: validateAccessCodeMock,
    markAccessCodeAsUsed: markAccessCodeAsUsedMock,
    updateUserProfile: vi.fn(),
    redeemParentInvite: vi.fn(),
    redeemHouseholdInvite: vi.fn(),
    redeemCoParentInvite: vi.fn(),
    rollbackParentInviteRedemption: vi.fn(),
    redeemFriendInvite: vi.fn(),
    getUserProfile: vi.fn(),
    getUserTeams: vi.fn(),
    getUserByEmail: vi.fn(),
    getTeam: vi.fn(),
    listMyParentMembershipRequests: vi.fn(),
    normalizeParentScopeLinks: vi.fn()
}));

vi.mock('../../js/signup-flow.js?v=9', () => ({
    executeEmailPasswordSignup: vi.fn()
}));

vi.mock('../../js/admin-invite.js?v=6', () => ({
    redeemAdminInviteAcceptance: vi.fn(),
    redeemAdminInviteAtomically: vi.fn()
}));

vi.mock('../../js/parent-membership-utils.js?v=2', () => ({
    mergeApprovedParentMembershipRequests: vi.fn(() => ({ changed: false, userUpdate: {} }))
}));

describe('loginWithGoogle popup fallback handling', () => {
    let sessionStorageMock;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
        validateAccessCodeMock.mockResolvedValue({ valid: true, type: 'standard', codeId: 'standard-code' });
        markAccessCodeAsUsedMock.mockResolvedValue(undefined);

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

    it('falls back to redirect when the popup is blocked', async () => {
        const popupError = new Error('Popup blocked');
        popupError.code = 'auth/popup-blocked';
        popupError.message = 'Popup blocked';
        signInWithPopupMock.mockRejectedValue(popupError);
        signInWithRedirectMock.mockResolvedValue(undefined);

        const { loginWithGoogle } = await import('../../js/auth.js');

        await expect(loginWithGoogle('CODE1234')).resolves.toBeNull();

        expect(sessionStorageMock.setItem).toHaveBeenCalledWith('pendingActivationCode', 'CODE1234');
        expect(signInWithRedirectMock).toHaveBeenCalledTimes(1);
        expect(sessionStorageMock.removeItem).not.toHaveBeenCalledWith('pendingActivationCode');
    });

    it('does not redirect when the user closes the popup', async () => {
        const popupError = new Error('Popup closed by user');
        popupError.code = 'auth/popup-closed-by-user';
        popupError.message = 'Popup closed by user';
        signInWithPopupMock.mockRejectedValue(popupError);

        const { loginWithGoogle } = await import('../../js/auth.js');

        await expect(loginWithGoogle('CODE1234')).rejects.toMatchObject({
            code: 'auth/popup-closed-by-user'
        });

        expect(signInWithRedirectMock).not.toHaveBeenCalled();
        expect(sessionStorageMock.removeItem).toHaveBeenCalledWith('pendingActivationCode');
    });

    it('does not redirect when Firebase cancels a duplicate popup request', async () => {
        const popupError = new Error('Popup request cancelled');
        popupError.code = 'auth/cancelled-popup-request';
        popupError.message = 'Popup request cancelled';
        signInWithPopupMock.mockRejectedValue(popupError);

        const { loginWithGoogle } = await import('../../js/auth.js');

        await expect(loginWithGoogle('CODE1234')).rejects.toMatchObject({
            code: 'auth/cancelled-popup-request'
        });

        expect(signInWithRedirectMock).not.toHaveBeenCalled();
        expect(sessionStorageMock.removeItem).toHaveBeenCalledWith('pendingActivationCode');
    });

    it('clears an invite code after successful popup sign-in for an existing user', async () => {
        signInWithPopupMock.mockResolvedValue({
            user: {
                uid: 'existing-user',
                email: 'existing@example.com',
                metadata: {
                    creationTime: '2026-01-01T00:00:00.000Z',
                    lastSignInTime: '2026-07-09T20:00:00.000Z'
                }
            }
        });

        const { loginWithGoogle } = await import('../../js/auth.js');

        await expect(loginWithGoogle('INVITE123')).resolves.toMatchObject({
            user: { uid: 'existing-user' }
        });

        expect(sessionStorageMock.setItem).toHaveBeenCalledWith('pendingActivationCode', 'INVITE123');
        expect(markAccessCodeAsUsedMock).toHaveBeenCalledWith('standard-code', 'existing-user');
        expect(sessionStorageMock.removeItem).toHaveBeenCalledWith('pendingActivationCode');
    });

    it('clears a stored invite code after successful redirect sign-in for an existing user', async () => {
        sessionStorageMock.getItem.mockReturnValue('STALE123');
        getRedirectResultMock.mockResolvedValue({
            user: {
                uid: 'existing-redirect-user',
                email: 'redirect@example.com',
                metadata: {
                    creationTime: '2026-01-01T00:00:00.000Z',
                    lastSignInTime: '2026-07-09T20:00:00.000Z'
                }
            }
        });

        const { handleGoogleRedirectResult } = await import('../../js/auth.js');

        await expect(handleGoogleRedirectResult()).resolves.toMatchObject({
            user: { uid: 'existing-redirect-user' }
        });

        expect(markAccessCodeAsUsedMock).toHaveBeenCalledWith('standard-code', 'existing-redirect-user');
        expect(sessionStorageMock.removeItem).toHaveBeenCalledWith('pendingActivationCode');
    });
});
