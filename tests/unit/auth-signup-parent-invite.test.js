import { describe, it, expect, vi, beforeEach } from 'vitest';

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

const dbMocks = vi.hoisted(() => {
    return {
        validateAccessCode: vi.fn(),
        markAccessCodeAsUsed: vi.fn(),
        updateUserProfile: vi.fn(),
        redeemParentInvite: vi.fn(),
        getUserProfile: vi.fn(),
        getUserTeams: vi.fn(),
        getUserByEmail: vi.fn()
    };
});

vi.mock('../../js/firebase.js?v=9', () => firebaseMocks);
vi.mock('../../js/db.js?v=14', () => dbMocks);

const { signup } = await import('../../js/auth.js');

describe('signup parent invite flow', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('rejects when parent invite linking fails', async () => {
        dbMocks.validateAccessCode.mockResolvedValue({
            valid: true,
            type: 'parent_invite',
            data: { code: 'PARENT1' }
        });
        firebaseMocks.createUserWithEmailAndPassword.mockResolvedValue({
            user: { uid: 'user-1' }
        });
        dbMocks.redeemParentInvite.mockRejectedValue(new Error('Team or Player not found'));

        await expect(signup('parent@example.com', 'password123', 'PARENT1')).rejects.toThrow('Team or Player not found');
    });

    it('continues to support standard activation code signup', async () => {
        dbMocks.validateAccessCode.mockResolvedValue({
            valid: true,
            type: 'coach',
            codeId: 'code-1'
        });
        firebaseMocks.createUserWithEmailAndPassword.mockResolvedValue({
            user: { uid: 'user-2' }
        });

        await expect(signup('coach@example.com', 'password123', 'COACH1')).resolves.toEqual({
            user: { uid: 'user-2' }
        });

        expect(dbMocks.markAccessCodeAsUsed).toHaveBeenCalledWith('code-1', 'user-2');
    });
});
