import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    sendPasswordResetEmail: vi.fn(),
    sendEmailVerification: vi.fn(),
    sendSignInLinkToEmail: vi.fn(),
    isSignInWithEmailLink: vi.fn(),
    signInWithEmailLink: vi.fn(),
    updatePassword: vi.fn()
}));

const dbMocks = vi.hoisted(() => ({
    validateAccessCode: vi.fn(),
    markAccessCodeAsUsed: vi.fn(),
    updateUserProfile: vi.fn(),
    redeemParentInvite: vi.fn(),
    getUserProfile: vi.fn(),
    getUserTeams: vi.fn(),
    getUserByEmail: vi.fn(),
    getTeam: vi.fn(),
    addTeamAdminEmail: vi.fn(),
    listMyParentMembershipRequests: vi.fn()
}));

vi.mock('../../js/firebase.js?v=10', () => firebaseMocks);
vi.mock('../../js/db.js?v=15', () => dbMocks);
vi.mock('../../js/signup-flow.js?v=2', () => ({
    executeEmailPasswordSignup: vi.fn()
}));
vi.mock('../../js/admin-invite.js?v=3', () => ({
    redeemAdminInviteAcceptance: vi.fn()
}));

const { checkAuth } = await import('../../js/auth.js');

describe('auth parent membership sync', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firebaseMocks.auth.currentUser = null;
    });

    it('self-syncs approved parent membership requests into the signed-in user profile', async () => {
        const user = {
            uid: 'parent-1',
            email: 'parent@example.com'
        };
        const callback = vi.fn();

        dbMocks.getUserProfile.mockResolvedValue({
            email: 'parent@example.com',
            roles: ['member']
        });
        dbMocks.listMyParentMembershipRequests.mockResolvedValue([
            {
                status: 'approved',
                requesterUserId: 'parent-1',
                requesterEmail: 'parent@example.com',
                teamId: 'team-1',
                teamName: 'Falcons',
                playerId: 'player-9',
                playerName: 'Avery Lee',
                playerNumber: '9',
                relation: 'Guardian'
            }
        ]);
        dbMocks.updateUserProfile.mockResolvedValue(undefined);
        dbMocks.getUserTeams.mockResolvedValue([]);
        firebaseMocks.onAuthStateChanged.mockImplementation(async (_auth, handler) => {
            await handler(user);
            return vi.fn();
        });

        await checkAuth(callback);

        expect(dbMocks.listMyParentMembershipRequests).toHaveBeenCalledWith('parent-1');
        expect(dbMocks.updateUserProfile).toHaveBeenCalledWith('parent-1', expect.objectContaining({
            roles: ['member', 'parent'],
            parentTeamIds: ['team-1'],
            parentPlayerKeys: ['team-1::player-9']
        }));
        expect(callback).toHaveBeenCalledWith(expect.objectContaining({
            uid: 'parent-1',
            parentOf: [expect.objectContaining({
                teamId: 'team-1',
                playerId: 'player-9'
            })],
            roles: ['member', 'parent']
        }));
    });
});
