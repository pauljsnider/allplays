// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { beforeEach, expect, it, vi } from 'vitest';
import { executeEmailPasswordSignup } from '../../js/signup-flow.js';
import { createInviteProcessor } from '../../js/accept-invite-flow.js';

const require = createRequire(import.meta.url);
const { createFriendInviteRedemptionCallableHandler, createFriendInviteRedemptionTransaction } = require('../../functions/friend-invite-redemption-core.cjs');
const { buildGenericPreAuthAccessCodeValidationResult, validateAccessCodeCandidates } = require('../../functions/access-code-validation.cjs');
class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
}

beforeEach(() => localStorage.clear());

it('keeps a password signup until verification, then redeems and resumes safely using real backend contracts', async () => {
    // Only Firebase I/O is simulated. Signup, validation, identity enforcement,
    // redemption transaction, and acceptance/replay routing use production code.
    const code = 'FRIEND12';
    const now = new Date('2026-01-01T00:00:00Z');
    const documents = new Map([[`accessCodes/${code}`, {
        code, type: 'friend_invite', email: 'friend@example.com', generatedBy: 'inviter',
        used: false, expiresAt: new Date('2026-01-08T00:00:00Z'), inviterProfile: { fullName: 'Synthetic Inviter' }
    }]]);
    const runTransaction = vi.fn(async (callback) => {
        const writes = [];
        const result = await callback({
            get: async (ref) => ({ exists: documents.has(ref), data: () => documents.get(ref) }),
            set: (ref, value) => writes.push(() => documents.set(ref, value)),
            update: (ref, value) => writes.push(() => documents.set(ref, { ...documents.get(ref), ...value }))
        });
        writes.forEach((write) => write());
        return result;
    });
    const redeemTransaction = createFriendInviteRedemptionTransaction({
        firestore: { doc: (path) => path, runTransaction }, Timestamp: { now: () => now }, HttpsError, logger: { warn: vi.fn(), error: vi.fn() }
    });
    const handler = createFriendInviteRedemptionCallableHandler({ redeemTransaction, HttpsError });
    const user = { uid: 'recipient', email: 'friend@example.com', emailVerified: false, delete: vi.fn(), reload: vi.fn() };
    const auth = { currentUser: null };
    const context = () => ({ auth: { uid: user.uid, token: { email: user.email, email_verified: user.emailVerified } } });
    const validateAccessCode = vi.fn(async () => auth.currentUser
        ? validateAccessCodeCandidates([{ id: code, data: documents.get(`accessCodes/${code}`) }], now.getTime(), user.uid)
        : buildGenericPreAuthAccessCodeValidationResult());
    const redeemFriendInvite = vi.fn(async () => handler({ code }, context()));
    const dependencies = {
        validateAccessCode, redeemFriendInvite,
        createUserWithEmailAndPassword: vi.fn(async () => { auth.currentUser = user; return { user }; }),
        updateUserProfile: vi.fn(), sendVerificationEmail: vi.fn(), signOut: vi.fn(), markAccessCodeAsUsed: vi.fn()
    };
    const result = await executeEmailPasswordSignup({ email: user.email, password: 'synthetic-only', activationCode: code, auth, dependencies });
    expect(result.pendingFamilyInvite).toEqual({ code, type: 'friend' });
    expect(localStorage.getItem('inviteCode')).toBe(code);
    expect(dependencies.sendVerificationEmail).toHaveBeenCalledOnce();
    expect(user.delete).not.toHaveBeenCalled();
    expect(dependencies.signOut).not.toHaveBeenCalled();
    expect(redeemFriendInvite).not.toHaveBeenCalled();
    expect(documents.get(`accessCodes/${code}`).used).toBe(false);
    await expect(handler({ code }, context())).rejects.toMatchObject({ code: 'permission-denied' });
    expect(runTransaction).not.toHaveBeenCalled();

    user.emailVerified = true; // Represents a refreshed verified Auth token.
    const accept = createInviteProcessor({ validateAccessCode, redeemFriendInvite });
    await expect(accept(user.uid, code, user.email)).resolves.toMatchObject({ success: true, redirectUrl: '/app/#/home?section=friends' });
    expect(documents.get(`accessCodes/${code}`)).toMatchObject({ used: true, usedBy: user.uid });
    expect(documents.get('friendships/inviter__recipient')).toMatchObject({ status: 'accepted', memberIds: ['inviter', 'recipient'] });
    await expect(accept(user.uid, code, user.email)).resolves.toMatchObject({ success: true, alreadyRedeemed: true });
    expect(redeemFriendInvite).toHaveBeenCalledOnce();
    expect(dependencies.markAccessCodeAsUsed).not.toHaveBeenCalled();
    expect(validateAccessCodeCandidates([{ id: code, data: documents.get(`accessCodes/${code}`) }], now.getTime(), 'someone-else').valid).toBe(false);
    // Direct callable replay remains denied even for the original recipient.
    await expect(handler({ code }, context())).rejects.toMatchObject({ code: 'permission-denied' });
});
