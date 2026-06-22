import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const signInWithPopupMock = vi.fn();
const signInWithRedirectMock = vi.fn();

vi.mock('../../js/firebase.js?v=19', () => ({
    auth: { currentUser: null },
    signInWithEmailAndPassword: vi.fn(),
    createUserWithEmailAndPassword: vi.fn(),
    signOut: vi.fn(),
    onAuthStateChanged: vi.fn(),
    GoogleAuthProvider: class MockGoogleAuthProvider {},
    signInWithPopup: signInWithPopupMock,
    signInWithRedirect: signInWithRedirectMock,
    getRedirectResult: vi.fn(),
    sendPasswordResetEmail: vi.fn(),
    sendEmailVerification: vi.fn(),
    sendSignInLinkToEmail: vi.fn(),
    isSignInWithEmailLink: vi.fn(),
    signInWithEmailLink: vi.fn(),
    updatePassword: vi.fn()
}));

vi.mock('../../js/db.js?v=63', () => ({
    validateAccessCode: vi.fn(),
    markAccessCodeAsUsed: vi.fn(),
    updateUserProfile: vi.fn(),
    redeemParentInvite: vi.fn(),
    getUserProfile: vi.fn(),
    getUserTeams: vi.fn(),
    getUserByEmail: vi.fn(),
    getTeam: vi.fn(),
    listMyParentMembershipRequests: vi.fn()
}));

vi.mock('../../js/signup-flow.js?v=5', () => ({
    executeEmailPasswordSignup: vi.fn()
}));

vi.mock('../../js/admin-invite.js?v=5', () => ({
    redeemAdminInviteAcceptance: vi.fn()
}));

vi.mock('../../js/parent-membership-utils.js?v=2', () => ({
    mergeApprovedParentMembershipRequests: vi.fn(() => ({ changed: false, userUpdate: {} }))
}));

describe('loginWithGoogle popup fallback handling', () => {
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
});
