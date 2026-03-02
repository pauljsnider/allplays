import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const firebaseMocks = vi.hoisted(() => {
    return {
        auth: { currentUser: null },
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
    getTeam: vi.fn(),
    addTeamAdminEmail: vi.fn(),
    getUserProfile: vi.fn(),
    getUserTeams: vi.fn(),
    getUserByEmail: vi.fn()
}));

vi.mock('../../js/firebase.js?v=9', () => firebaseMocks);
vi.mock('../../js/db.js?v=14', () => dbMocks);

const { signup, loginWithGoogle } = await import('../../js/auth.js');

describe('auth signup parent invite failure handling', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firebaseMocks.auth.currentUser = null;
        const sessionStorageState = {};
        vi.stubGlobal('window', {
            sessionStorage: {
                getItem: vi.fn((key) => sessionStorageState[key] ?? null),
                setItem: vi.fn((key, value) => {
                    sessionStorageState[key] = String(value);
                }),
                removeItem: vi.fn((key) => {
                    delete sessionStorageState[key];
                })
            }
        });
    });

    it('rejects signup when parent invite linking fails', async () => {
        const deleteMock = vi.fn().mockResolvedValue(undefined);
        const user = {
            uid: 'user-1',
            email: 'parent@example.com',
            reload: vi.fn().mockResolvedValue(undefined),
            delete: deleteMock
        };
        firebaseMocks.auth.currentUser = user;
        dbMocks.validateAccessCode.mockResolvedValue({
            valid: true,
            type: 'parent_invite',
            data: { code: 'PARENT1' }
        });
        firebaseMocks.createUserWithEmailAndPassword.mockResolvedValue({ user });
        dbMocks.redeemParentInvite.mockRejectedValue(new Error('Team or Player not found'));

        await expect(signup('parent@example.com', 'password123', 'PARENT1')).rejects.toThrow('Team or Player not found');
        expect(dbMocks.redeemParentInvite).toHaveBeenCalledWith('user-1', 'PARENT1');
        expect(deleteMock).toHaveBeenCalledTimes(1);
        expect(firebaseMocks.signOut).toHaveBeenCalledWith(firebaseMocks.auth);
        expect(dbMocks.markAccessCodeAsUsed).not.toHaveBeenCalled();
        expect(dbMocks.updateUserProfile).not.toHaveBeenCalled();
        expect(firebaseMocks.sendEmailVerification).not.toHaveBeenCalled();
    });

    it('does not fail signup when parent invite profile finalization fails after redeem', async () => {
        const deleteMock = vi.fn().mockResolvedValue(undefined);
        const user = {
            uid: 'user-1',
            email: 'parent@example.com',
            reload: vi.fn().mockResolvedValue(undefined),
            delete: deleteMock
        };
        firebaseMocks.auth.currentUser = user;
        dbMocks.validateAccessCode.mockResolvedValue({
            valid: true,
            type: 'parent_invite',
            data: { code: 'PARENT01' }
        });
        firebaseMocks.createUserWithEmailAndPassword.mockResolvedValue({ user });
        dbMocks.redeemParentInvite.mockResolvedValue({ success: true });
        dbMocks.updateUserProfile.mockRejectedValue(new Error('profile write failed'));

        await expect(signup('parent@example.com', 'secret123', 'PARENT01')).resolves.toEqual({ user });
        expect(dbMocks.redeemParentInvite).toHaveBeenCalledWith('user-1', 'PARENT01');
        expect(deleteMock).not.toHaveBeenCalled();
        expect(firebaseMocks.signOut).not.toHaveBeenCalled();
        expect(firebaseMocks.sendEmailVerification).toHaveBeenCalledWith(user);
    });

    it('delegates signup flow to executeEmailPasswordSignup with parent invite dependencies', () => {
        const authSource = readFileSync(resolve(process.cwd(), 'js/auth.js'), 'utf8');
        const signupSection = authSource.split('export async function signup')[1]?.split('export async function loginWithGoogle')[0];

        expect(signupSection).toBeTruthy();
        expect(signupSection).toContain('return executeEmailPasswordSignup');
        expect(signupSection).toContain('redeemParentInvite');
        expect(signupSection).toContain('updateUserProfile');
        expect(signupSection).toContain('markAccessCodeAsUsed');
        expect(signupSection).toContain('sendEmailVerification');
        expect(signupSection).toContain('signOut');
    });

    it('does not trigger auth-user cleanup when profile write fails after parent invite redeem', async () => {
        const user = {
            uid: 'user-1',
            email: 'parent@example.com',
            reload: vi.fn().mockResolvedValue(undefined),
            delete: vi.fn().mockRejectedValue(new Error('delete failed'))
        };
        firebaseMocks.auth.currentUser = user;
        dbMocks.validateAccessCode.mockResolvedValue({
            valid: true,
            type: 'parent_invite',
            data: { code: 'PARENT01' }
        });
        firebaseMocks.createUserWithEmailAndPassword.mockResolvedValue({ user });
        dbMocks.redeemParentInvite.mockResolvedValue({ success: true });
        dbMocks.updateUserProfile.mockRejectedValue(new Error('profile write failed'));

        await expect(signup('parent@example.com', 'secret123', 'PARENT01')).resolves.toEqual({ user });
        expect(user.delete).not.toHaveBeenCalled();
        expect(firebaseMocks.signOut).not.toHaveBeenCalled();
        expect(firebaseMocks.sendEmailVerification).toHaveBeenCalledWith(user);
    });

    it('rejects google signup when parent invite linking fails', async () => {
        const deleteMock = vi.fn().mockResolvedValue(undefined);
        dbMocks.validateAccessCode.mockResolvedValue({
            valid: true,
            type: 'parent_invite',
            data: { code: 'PARENT1' }
        });
        firebaseMocks.signInWithPopup.mockResolvedValue({
            user: {
                uid: 'google-user-1',
                email: 'parent@example.com',
                displayName: 'Parent',
                photoURL: 'https://example.com/photo.png',
                metadata: {
                    creationTime: '2026-02-28T00:00:00.000Z',
                    lastSignInTime: '2026-02-28T00:00:00.000Z'
                },
                delete: deleteMock
            }
        });
        dbMocks.redeemParentInvite.mockRejectedValue(new Error('Team or Player not found'));

        await expect(loginWithGoogle('PARENT1')).rejects.toThrow('Team or Player not found');
        expect(dbMocks.redeemParentInvite).toHaveBeenCalledWith('google-user-1', 'PARENT1');
        expect(deleteMock).toHaveBeenCalledTimes(1);
        expect(firebaseMocks.signOut).toHaveBeenCalledWith(firebaseMocks.auth);
        expect(dbMocks.markAccessCodeAsUsed).not.toHaveBeenCalled();
        expect(dbMocks.updateUserProfile).not.toHaveBeenCalled();
        expect(firebaseMocks.sendEmailVerification).not.toHaveBeenCalled();
    });

    it('does not fail signup when parent invite profile write fails after redeem', async () => {
        dbMocks.validateAccessCode.mockResolvedValue({
            valid: true,
            type: 'parent_invite',
            data: { code: 'PARENT1' }
        });
        firebaseMocks.createUserWithEmailAndPassword.mockResolvedValue({
            user: { uid: 'user-3', delete: vi.fn().mockResolvedValue() }
        });
        dbMocks.redeemParentInvite.mockResolvedValue();
        dbMocks.updateUserProfile.mockRejectedValue(new Error('Firestore unavailable'));

        await expect(signup('parent2@example.com', 'password123', 'PARENT1')).resolves.toEqual({
            user: { uid: 'user-3', delete: expect.any(Function) }
        });
        expect(dbMocks.redeemParentInvite).toHaveBeenCalledWith('user-3', 'PARENT1');
        expect(firebaseMocks.signOut).not.toHaveBeenCalled();
    });

    it('does not fail google signup when parent invite profile write fails after redeem', async () => {
        dbMocks.validateAccessCode.mockResolvedValue({
            valid: true,
            type: 'parent_invite',
            data: { code: 'PARENT1' }
        });
        const deleteMock = vi.fn().mockResolvedValue();
        firebaseMocks.signInWithPopup.mockResolvedValue({
            user: {
                uid: 'google-user-2',
                email: 'parent2@example.com',
                displayName: 'Parent Two',
                photoURL: 'https://example.com/photo2.png',
                metadata: {
                    creationTime: '2026-02-28T00:00:00.000Z',
                    lastSignInTime: '2026-02-28T00:00:00.000Z'
                },
                delete: deleteMock
            }
        });
        dbMocks.redeemParentInvite.mockResolvedValue();
        dbMocks.updateUserProfile.mockRejectedValue(new Error('Firestore unavailable'));

        await expect(loginWithGoogle('PARENT1')).resolves.toMatchObject({
            user: { uid: 'google-user-2' }
        });
        expect(dbMocks.redeemParentInvite).toHaveBeenCalledWith('google-user-2', 'PARENT1');
        expect(deleteMock).not.toHaveBeenCalled();
        expect(firebaseMocks.signOut).not.toHaveBeenCalled();
    });

    it('continues to support standard activation code signup', async () => {
        dbMocks.validateAccessCode.mockResolvedValue({
            valid: true,
            type: 'coach',
            codeId: 'code-1'
        });
        dbMocks.updateUserProfile.mockResolvedValue();
        firebaseMocks.createUserWithEmailAndPassword.mockResolvedValue({
            user: { uid: 'user-2' }
        });

        await expect(signup('coach@example.com', 'password123', 'COACH1')).resolves.toEqual({
            user: { uid: 'user-2' }
        });
        expect(dbMocks.markAccessCodeAsUsed).toHaveBeenCalledWith('code-1', 'user-2');
    });
});
