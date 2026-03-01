import { describe, it, expect, vi, beforeEach } from 'vitest';

const firebaseMocks = vi.hoisted(() => {
    const auth = { currentUser: null };
    return {
        auth,
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

const dbMocks = vi.hoisted(() => ({
    validateAccessCode: vi.fn(),
    markAccessCodeAsUsed: vi.fn(),
    updateUserProfile: vi.fn(),
    redeemParentInvite: vi.fn(),
    getUserProfile: vi.fn(),
    getUserTeams: vi.fn(),
    getUserByEmail: vi.fn()
}));

vi.mock('../../js/firebase.js?v=9', () => firebaseMocks);
vi.mock('../../js/db.js?v=14', () => dbMocks);

import { signup } from '../../js/auth.js';

describe('auth signup parent invite handling', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        const user = {
            uid: 'user-1',
            email: 'parent@example.com',
            reload: vi.fn().mockResolvedValue(undefined),
            delete: vi.fn().mockResolvedValue(undefined)
        };

        firebaseMocks.auth.currentUser = user;
        firebaseMocks.createUserWithEmailAndPassword.mockResolvedValue({ user });
        dbMocks.validateAccessCode.mockResolvedValue({
            valid: true,
            type: 'parent_invite',
            data: { code: 'PARENT01' }
        });
        dbMocks.redeemParentInvite.mockResolvedValue({ success: true });
        dbMocks.updateUserProfile.mockResolvedValue(undefined);
        firebaseMocks.sendEmailVerification.mockResolvedValue(undefined);
    });

    it('rejects signup when parent invite profile finalization fails', async () => {
        const user = firebaseMocks.auth.currentUser;
        dbMocks.updateUserProfile.mockRejectedValue(new Error('profile write failed'));

        await expect(signup('parent@example.com', 'secret123', 'PARENT01')).rejects.toThrow('profile write failed');

        expect(dbMocks.redeemParentInvite).toHaveBeenCalledWith('user-1', 'PARENT01');
        expect(user.delete).toHaveBeenCalledTimes(1);
        expect(firebaseMocks.signOut).toHaveBeenCalledWith(firebaseMocks.auth);
        expect(firebaseMocks.sendEmailVerification).not.toHaveBeenCalled();
    });

    it('still signs out and rethrows when auth-user cleanup delete fails', async () => {
        const user = firebaseMocks.auth.currentUser;
        const profileError = new Error('profile write failed');
        user.delete.mockRejectedValue(new Error('delete failed'));
        dbMocks.updateUserProfile.mockRejectedValue(profileError);

        await expect(signup('parent@example.com', 'secret123', 'PARENT01')).rejects.toThrow('profile write failed');

        expect(user.delete).toHaveBeenCalledTimes(1);
        expect(firebaseMocks.signOut).toHaveBeenCalledWith(firebaseMocks.auth);
    });
});
