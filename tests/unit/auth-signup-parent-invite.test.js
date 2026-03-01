import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

describe('auth signup parent invite failure handling', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firebaseMocks.auth.currentUser = null;
        dbMocks.validateAccessCode.mockResolvedValue({
            valid: true,
            type: 'parent_invite',
            data: { code: 'PARENT01' }
        });
        dbMocks.redeemParentInvite.mockResolvedValue({ success: true });
        dbMocks.updateUserProfile.mockResolvedValue(undefined);
        firebaseMocks.sendEmailVerification.mockResolvedValue(undefined);
    });

    it('fails closed by rethrowing parent invite finalization errors', () => {
        const authSource = readFileSync(resolve(process.cwd(), 'js/auth.js'), 'utf8');
        const signupSection = authSource.split('export async function signup')[1]?.split('export async function loginWithGoogle')[0];

        expect(signupSection).toBeTruthy();

        const parentInviteCatchBlock = signupSection.match(/if \(validation\.type === 'parent_invite'\)[\s\S]*?catch \(e\) \{([\s\S]*?)\n\s*\}/);
        expect(parentInviteCatchBlock).toBeTruthy();

        const catchBody = parentInviteCatchBlock[1];
        expect(catchBody).toMatch(/throw\s+(e|new Error\()/);
        expect(catchBody).not.toContain("Don't fail the whole signup");
    });

    it('rejects signup when parent invite profile finalization fails', async () => {
        const mockDelete = vi.fn().mockResolvedValue(undefined);
        const user = {
            uid: 'user-1',
            email: 'parent@example.com',
            reload: vi.fn().mockResolvedValue(undefined),
            delete: mockDelete
        };
        firebaseMocks.auth.currentUser = user;
        firebaseMocks.createUserWithEmailAndPassword.mockResolvedValue({ user });
        dbMocks.updateUserProfile.mockRejectedValue(new Error('profile write failed'));

        await expect(signup('parent@example.com', 'secret123', 'PARENT01')).rejects.toThrow('profile write failed');

        expect(dbMocks.redeemParentInvite).toHaveBeenCalledWith('user-1', 'PARENT01');
        expect(mockDelete).toHaveBeenCalledTimes(1);
        expect(firebaseMocks.signOut).toHaveBeenCalledWith(firebaseMocks.auth);
        expect(firebaseMocks.sendEmailVerification).not.toHaveBeenCalled();
    });

    it('still signs out and rethrows when auth-user cleanup delete fails', async () => {
        const user = {
            uid: 'user-1',
            email: 'parent@example.com',
            reload: vi.fn().mockResolvedValue(undefined),
            delete: vi.fn().mockRejectedValue(new Error('delete failed'))
        };
        firebaseMocks.auth.currentUser = user;
        firebaseMocks.createUserWithEmailAndPassword.mockResolvedValue({ user });
        const profileError = new Error('profile write failed');
        dbMocks.updateUserProfile.mockRejectedValue(profileError);

        await expect(signup('parent@example.com', 'secret123', 'PARENT01')).rejects.toThrow('profile write failed');

        expect(user.delete).toHaveBeenCalledTimes(1);
        expect(firebaseMocks.signOut).toHaveBeenCalledWith(firebaseMocks.auth);
    });
});
