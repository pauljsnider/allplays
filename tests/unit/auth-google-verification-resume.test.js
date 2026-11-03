import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    signInWithPopup: vi.fn(),
    getRedirectResult: vi.fn(),
    signOut: vi.fn(),
    validateAccessCode: vi.fn(),
    redeemParentInvite: vi.fn(),
    redeemHouseholdInvite: vi.fn(),
    redeemCoParentInvite: vi.fn(),
    redeemFriendInvite: vi.fn(),
    redeemAdminInviteAcceptance: vi.fn(),
    updateUserProfile: vi.fn(),
    markAccessCodeAsUsed: vi.fn(),
    rollbackParentInviteRedemption: vi.fn(),
    queueCurrentUserVerificationEmail: vi.fn()
}));

vi.mock('../../js/firebase.js?v=33', () => ({
    auth: { currentUser: null },
    signInWithEmailAndPassword: vi.fn(),
    createUserWithEmailAndPassword: vi.fn(),
    signOut: mocks.signOut,
    onAuthStateChanged: vi.fn(),
    GoogleAuthProvider: class {},
    signInWithPopup: mocks.signInWithPopup,
    signInWithRedirect: vi.fn(),
    getRedirectResult: mocks.getRedirectResult,
    isSignInWithEmailLink: vi.fn(),
    signInWithEmailLink: vi.fn(),
    updatePassword: vi.fn()
}));
vi.mock('../../js/db.js?v=4433210', () => ({
    ...mocks,
    getUserProfile: vi.fn(),
    getUserTeams: vi.fn(),
    getTeam: vi.fn(),
    listMyParentMembershipRequests: vi.fn(),
    normalizeParentScopeLinks: vi.fn()
}));
vi.mock('../../js/admin-invite.js?v=12', () => ({
    redeemAdminInviteAcceptance: mocks.redeemAdminInviteAcceptance,
    redeemAdminInviteAtomically: vi.fn()
}));
vi.mock('../../js/auth-email.js?v=8', () => ({
    queueCurrentUserVerificationEmail: mocks.queueCurrentUserVerificationEmail,
    queueInviteSignInEmail: vi.fn(),
    queuePasswordResetEmail: vi.fn()
}));

import { handleGoogleRedirectResult, loginWithGoogle } from '../../js/auth.js';

function createStorage() {
    const values = new Map();
    return {
        setItem: (key, value) => values.set(key, String(value)),
        getItem: (key) => values.get(key) ?? null,
        removeItem: (key) => values.delete(key)
    };
}

const invitationTypes = [
    ['parent', mocks.redeemParentInvite],
    ['household', mocks.redeemHouseholdInvite],
    ['coparent', mocks.redeemCoParentInvite],
    ['admin', mocks.redeemAdminInviteAcceptance],
    ['friend', mocks.redeemFriendInvite]
];

function newUser(overrides = {}) {
    return {
        uid: 'synthetic-recipient',
        email: 'recipient@example.com',
        emailVerified: false,
        metadata: { creationTime: 'same-time', lastSignInTime: 'same-time' },
        reload: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        ...overrides
    };
}

function prepareInvite(type, user) {
    const result = { user };
    mocks.signInWithPopup.mockResolvedValue(result);
    mocks.getRedirectResult.mockResolvedValue(result);
    mocks.validateAccessCode.mockResolvedValue({
        valid: true,
        type: `${type}_invite`,
        codeId: 'synthetic-code-id',
        data: { code: 'CANON123' }
    });
    return result;
}

beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('window', { localStorage: createStorage(), sessionStorage: createStorage() });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

for (const flow of ['popup', 'redirect']) {
    describe(`legacy Google ${flow} verification resume`, () => {
        it.each(invitationTypes)('retains the new account and canonical %s invitation while verification is pending', async (type, redeem) => {
            const user = newUser();
            prepareInvite(type, user);
            redeem.mockRejectedValue(Object.assign(new Error('Verify your email first.'), {
                details: { reason: 'email-verification-required' }
            }));
            window.sessionStorage.setItem('pendingActivationCode', 'ALIAS123');
            window.localStorage.setItem('allplays-app-pending-invite-code', 'STALE123');
            window.localStorage.setItem('allplays-app-pending-invite-type', 'admin');

            const result = flow === 'popup' ? await loginWithGoogle('ALIAS123') : await handleGoogleRedirectResult();

            expect(result.pendingFamilyInvite).toEqual({ code: 'CANON123', type });
            expect(result.wasNewUser).toBe(true);
            expect(result.activationCodeRedeemed).not.toBe(true);
            expect(window.localStorage.getItem('inviteCode')).toBe('CANON123');
            expect(window.localStorage.getItem('inviteType')).toBe(type);
            expect(window.localStorage.getItem('allplays-app-pending-invite-code')).toBe('CANON123');
            expect(window.localStorage.getItem('allplays-app-pending-invite-type')).toBe(type);
            expect(window.sessionStorage.getItem('pendingActivationCode')).toBeNull();
            expect(mocks.updateUserProfile).toHaveBeenCalledWith(user.uid, expect.objectContaining({
                email: user.email, emailVerificationRequired: true
            }));
            expect(mocks.queueCurrentUserVerificationEmail).toHaveBeenCalledTimes(1);
            expect(user.delete).not.toHaveBeenCalled();
            expect(mocks.signOut).not.toHaveBeenCalled();
            expect(mocks.rollbackParentInviteRedemption).not.toHaveBeenCalled();
            expect(mocks.markAccessCodeAsUsed).not.toHaveBeenCalled();
            if (type === 'friend') expect(redeem).not.toHaveBeenCalled();
        });
    });
}

describe('legacy Google verification boundaries', () => {
    it.each(['popup', 'redirect'])('preserves an invite for an existing unverified Google account in the %s flow', async (flow) => {
        const user = newUser({
            metadata: { creationTime: 'created-earlier', lastSignInTime: 'signed-in-now' }
        });
        prepareInvite('friend', user);
        mocks.redeemFriendInvite.mockRejectedValue(Object.assign(new Error('Verify your email first.'), {
            details: { reason: 'email-verification-required' }
        }));
        window.sessionStorage.setItem('pendingActivationCode', 'ALIAS123');

        const result = flow === 'popup' ? await loginWithGoogle('ALIAS123') : await handleGoogleRedirectResult();

        expect(result.pendingFamilyInvite).toEqual({ code: 'CANON123', type: 'friend' });
        expect(result.wasNewUser).toBe(false);
        expect(result.activationCodeRedeemed).not.toBe(true);
        expect(window.localStorage.getItem('allplays-app-pending-invite-code')).toBe('CANON123');
        expect(window.localStorage.getItem('allplays-app-pending-invite-type')).toBe('friend');
        expect(user.delete).not.toHaveBeenCalled();
        expect(mocks.signOut).not.toHaveBeenCalled();
        expect(mocks.queueCurrentUserVerificationEmail).toHaveBeenCalledTimes(1);
    });

    it.each(invitationTypes)('still fails closed for a generic %s redemption rejection', async (type, redeem) => {
        const user = newUser({ emailVerified: true });
        prepareInvite(type, user);
        redeem.mockRejectedValue(new Error('Invitation recipient does not match.'));

        await expect(loginWithGoogle('ALIAS123')).rejects.toThrow('Invitation recipient does not match.');

        expect(user.delete).toHaveBeenCalledTimes(1);
        expect(mocks.signOut).toHaveBeenCalledTimes(1);
        expect(mocks.queueCurrentUserVerificationEmail).not.toHaveBeenCalled();
        expect(window.localStorage.getItem('inviteCode')).toBeNull();
    });

    it('keeps a deferred account available when profile persistence and verification email fail', async () => {
        const user = newUser();
        prepareInvite('friend', user);
        mocks.updateUserProfile.mockRejectedValue(new Error('Profile temporarily unavailable.'));
        mocks.queueCurrentUserVerificationEmail.mockRejectedValue(new Error('Email temporarily unavailable.'));

        const result = await loginWithGoogle('ALIAS123');

        expect(result.pendingFamilyInvite).toEqual({ code: 'CANON123', type: 'friend' });
        expect(user.delete).not.toHaveBeenCalled();
        expect(mocks.signOut).not.toHaveBeenCalled();
        expect(mocks.queueCurrentUserVerificationEmail).toHaveBeenCalledTimes(1);
    });

    it('lets the backend redeem an email-less parent invitation for an unverified account', async () => {
        const user = newUser();
        prepareInvite('parent', user);
        mocks.redeemParentInvite.mockResolvedValue({ success: true });

        const result = await loginWithGoogle('ALIAS123');

        expect(mocks.redeemParentInvite).toHaveBeenCalledWith(user.uid, 'CANON123', user.email);
        expect(result.activationCodeRedeemed).toBe(true);
        expect(result.pendingFamilyInvite).toBeUndefined();
        expect(mocks.queueCurrentUserVerificationEmail).not.toHaveBeenCalled();
    });

    it('lets an authenticated phone identity redeem a friend invitation without verified email', async () => {
        const user = newUser({ phoneNumber: '+12025550123' });
        prepareInvite('friend', user);
        mocks.redeemFriendInvite.mockResolvedValue({ success: true });

        const result = await loginWithGoogle('ALIAS123');

        expect(mocks.redeemFriendInvite).toHaveBeenCalledWith(user.uid, 'CANON123', user.email);
        expect(result.activationCodeRedeemed).toBe(true);
        expect(result.pendingFamilyInvite).toBeUndefined();
    });
});
