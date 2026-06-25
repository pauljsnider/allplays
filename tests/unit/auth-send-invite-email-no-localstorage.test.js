import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sendSignInLinkToEmailMock = vi.fn();
const getUserByEmailMock = vi.fn();

vi.mock('../../js/firebase.js?v=19', () => ({
    auth: { currentUser: null },
    signInWithEmailAndPassword: vi.fn(),
    createUserWithEmailAndPassword: vi.fn(),
    signOut: vi.fn(),
    onAuthStateChanged: vi.fn(),
    GoogleAuthProvider: class MockGoogleAuthProvider {},
    signInWithPopup: vi.fn(),
    signInWithRedirect: vi.fn(),
    getRedirectResult: vi.fn(),
    sendPasswordResetEmail: vi.fn(),
    sendEmailVerification: vi.fn(),
    sendSignInLinkToEmail: sendSignInLinkToEmailMock,
    isSignInWithEmailLink: vi.fn(),
    signInWithEmailLink: vi.fn(),
    updatePassword: vi.fn()
}));

vi.mock('../../js/db.js?v=70', () => ({
    validateAccessCode: vi.fn(),
    markAccessCodeAsUsed: vi.fn(),
    updateUserProfile: vi.fn(),
    redeemParentInvite: vi.fn(),
    getTeam: vi.fn(),
    addTeamAdminEmail: vi.fn(),
    getUserProfile: vi.fn(),
    getUserTeams: vi.fn(),
    getUserByEmail: getUserByEmailMock,
    listMyParentMembershipRequests: vi.fn()
}));

describe('sendInviteEmail localStorage behavior', () => {
    let localStorageMock;

    beforeEach(() => {
        vi.clearAllMocks();

        localStorageMock = {
            setItem: vi.fn(),
            getItem: vi.fn().mockReturnValue(null),
            removeItem: vi.fn()
        };

        vi.stubGlobal('localStorage', localStorageMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('does NOT write emailForSignIn to localStorage when sending an invite', async () => {
        sendSignInLinkToEmailMock.mockResolvedValue(undefined);
        getUserByEmailMock.mockResolvedValue(null);

        const { sendInviteEmail } = await import('../../js/auth.js');

        await sendInviteEmail('recipient@example.com', 'INVITE123', 'parent');

        const setItemCalls = localStorageMock.setItem.mock.calls;
        const emailKeys = setItemCalls.map(([key]) => key).filter(k => k === 'emailForSignIn');
        expect(emailKeys).toHaveLength(0);
    });

    it('does NOT write inviteCode to localStorage when sending an invite', async () => {
        sendSignInLinkToEmailMock.mockResolvedValue(undefined);
        getUserByEmailMock.mockResolvedValue(null);

        const { sendInviteEmail } = await import('../../js/auth.js');

        await sendInviteEmail('recipient@example.com', 'INVITE123', 'parent');

        const setItemCalls = localStorageMock.setItem.mock.calls;
        const codeKeys = setItemCalls.map(([key]) => key).filter(k => k === 'inviteCode');
        expect(codeKeys).toHaveLength(0);
    });

    it('does NOT write inviteType to localStorage when sending an invite', async () => {
        sendSignInLinkToEmailMock.mockResolvedValue(undefined);
        getUserByEmailMock.mockResolvedValue(null);

        const { sendInviteEmail } = await import('../../js/auth.js');

        await sendInviteEmail('recipient@example.com', 'INVITE123', 'admin');

        const setItemCalls = localStorageMock.setItem.mock.calls;
        const typeKeys = setItemCalls.map(([key]) => key).filter(k => k === 'inviteType');
        expect(typeKeys).toHaveLength(0);
    });

    it('does NOT write any localStorage keys at all when sending an invite', async () => {
        sendSignInLinkToEmailMock.mockResolvedValue(undefined);
        getUserByEmailMock.mockResolvedValue(null);

        const { sendInviteEmail } = await import('../../js/auth.js');

        await sendInviteEmail('recipient@example.com', 'INVITE456', 'parent', { teamName: 'Eagles' });

        expect(localStorageMock.setItem).not.toHaveBeenCalled();
    });

    it('returns success result after sending invite without touching localStorage', async () => {
        sendSignInLinkToEmailMock.mockResolvedValue(undefined);
        getUserByEmailMock.mockResolvedValue(null);

        const { sendInviteEmail } = await import('../../js/auth.js');

        const result = await sendInviteEmail('newuser@example.com', 'CODE99', 'parent');

        expect(result).toEqual({ success: true, emailSent: true, existingUser: false });
        expect(localStorageMock.setItem).not.toHaveBeenCalled();
    });

    it('reports existingUser: true when recipient already has an account, and still does not write localStorage', async () => {
        sendSignInLinkToEmailMock.mockResolvedValue(undefined);
        getUserByEmailMock.mockResolvedValue({ uid: 'existing-uid', email: 'existing@example.com' });

        const { sendInviteEmail } = await import('../../js/auth.js');

        const result = await sendInviteEmail('existing@example.com', 'CODE77', 'admin');

        expect(result).toEqual({ success: true, emailSent: true, existingUser: true });
        expect(localStorageMock.setItem).not.toHaveBeenCalled();
    });
});
