import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
    auth: { currentUser: null },
    signInWithEmailAndPassword: vi.fn(),
    createUserWithEmailAndPassword: vi.fn(),
    signOut: vi.fn(),
    onAuthStateChanged: vi.fn(),
    GoogleAuthProvider: vi.fn(),
    signInWithPopup: vi.fn(),
    signInWithRedirect: vi.fn(),
    getRedirectResult: vi.fn(),
    isSignInWithEmailLink: vi.fn(),
    signInWithEmailLink: vi.fn(),
    limit: vi.fn(),
    updatePassword: vi.fn()
}));

const dbMocks = vi.hoisted(() => ({
    validateAccessCode: vi.fn(),
    markAccessCodeAsUsed: vi.fn(),
    updateUserProfile: vi.fn(),
    redeemParentInvite: vi.fn(),
    redeemHouseholdInvite: vi.fn(),
    redeemCoParentInvite: vi.fn(),
    redeemFriendInvite: vi.fn(),
    rollbackParentInviteRedemption: vi.fn(),
    getUserProfile: vi.fn(),
    getUserTeams: vi.fn(),
    getTeam: vi.fn(),
    listMyParentMembershipRequests: vi.fn(),
    normalizeParentScopeLinks: vi.fn()
}));

vi.mock('../../js/firebase.js?v=32', () => firebaseMocks);
vi.mock('../../js/db.js?v=4433188', () => dbMocks);
vi.mock('../../js/signup-flow.js?v=14', () => ({
    executeEmailPasswordSignup: vi.fn()
}));
vi.mock('../../js/admin-invite.js?v=11', () => ({
    redeemAdminInviteAcceptance: vi.fn(),
    redeemAdminInviteAtomically: vi.fn()
}));
vi.mock('../../js/parent-membership-utils.js?v=3', () => ({
    mergeApprovedParentMembershipRequests: vi.fn()
}));
vi.mock('../../js/accept-invite-flow.js?v=443314', () => ({
    createInviteProcessor: vi.fn()
}));
vi.mock('../../js/auth-email.js?v=6', () => ({
    queueCurrentUserVerificationEmail: vi.fn(),
    queueInviteSignInEmail: vi.fn(),
    queuePasswordResetEmail: vi.fn()
}));

const { login } = await import('../../js/auth.js');

describe('email/password login profile synchronization', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns the authenticated credential while profile synchronization is still pending', async () => {
        const credential = {
            user: {
                uid: 'user-1',
                email: 'owner@example.com'
            }
        };
        const pendingProfileSync = new Promise(() => {});
        firebaseMocks.signInWithEmailAndPassword.mockResolvedValue(credential);
        dbMocks.updateUserProfile.mockReturnValue(pendingProfileSync);

        await expect(login('owner@example.com', 'not-logged')).resolves.toBe(credential);
        await vi.waitFor(() => {
            expect(dbMocks.updateUserProfile).toHaveBeenCalledWith(
                'user-1',
                expect.objectContaining({
                    email: 'owner@example.com',
                    lastLogin: expect.any(Date)
                })
            );
        });
    });

    it('logs only a bounded error code when deferred synchronization fails', async () => {
        const credential = {
            user: {
                uid: 'user-2',
                email: 'owner@example.com'
            }
        };
        const profileError = Object.assign(
            new Error('owner@example.com failed with password not-logged'),
            { code: 'permission-denied' }
        );
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        firebaseMocks.signInWithEmailAndPassword.mockResolvedValue(credential);
        dbMocks.updateUserProfile.mockRejectedValue(profileError);

        await expect(login('owner@example.com', 'not-logged')).resolves.toBe(credential);
        await vi.waitFor(() => {
            expect(warn).toHaveBeenCalledWith(
                '[auth] Deferred login profile sync failed.',
                { code: 'permission-denied' }
            );
        });

        const serializedLog = JSON.stringify(warn.mock.calls);
        expect(serializedLog).not.toContain('owner@example.com');
        expect(serializedLog).not.toContain('not-logged');
        warn.mockRestore();
    });
});
