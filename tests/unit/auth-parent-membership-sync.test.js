import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';

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
    rollbackParentInviteRedemption: vi.fn(),
    redeemFriendInvite: vi.fn(),
    getUserProfile: vi.fn(),
    getUserTeams: vi.fn(),
    getUserByEmail: vi.fn(),
    getTeam: vi.fn(),
    addTeamAdminEmail: vi.fn(),
    listMyParentMembershipRequests: vi.fn(),
    normalizeParentScopeLinks: vi.fn()
}));
const profileRestMocks = vi.hoisted(() => ({
    loadAuthProfileViaRest: vi.fn()
}));

vi.mock('../../js/firebase.js?v=26', () => firebaseMocks);
vi.mock('../../js/db.js?v=4433180', () => dbMocks);
vi.mock('../../js/auth-profile-rest.js?v=1', () => profileRestMocks);
vi.mock('../../js/signup-flow.js?v=14', () => ({
    executeEmailPasswordSignup: vi.fn()
}));
vi.mock('../../js/admin-invite.js?v=9', () => ({
    redeemAdminInviteAcceptance: vi.fn()
}));

const { checkAuth } = await import('../../js/auth.js');
const { canContributeTeamMedia } = await import('../../js/team-media-utils.js');

describe('auth parent membership sync', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firebaseMocks.auth.currentUser = null;
        profileRestMocks.loadAuthProfileViaRest.mockResolvedValue(null);
        dbMocks.normalizeParentScopeLinks.mockResolvedValue({
            activeLinks: [],
            parentTeamIds: [],
            parentPlayerKeys: []
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('uses authenticated REST after the SDK profile read stalls without waiting for its timeout', async () => {
        vi.useFakeTimers();
        const user = { uid: 'parent-1', email: 'parent@example.com' };
        const callback = vi.fn();
        dbMocks.getUserProfile.mockImplementation(() => new Promise(() => {}));
        dbMocks.listMyParentMembershipRequests.mockImplementation(() => new Promise(() => {}));
        dbMocks.getUserTeams.mockImplementation(() => new Promise(() => {}));
        profileRestMocks.loadAuthProfileViaRest.mockResolvedValue({
            email: 'parent@example.com',
            roles: ['parent'],
            parentOf: [{ teamId: 'team-1', playerId: 'player-9' }]
        });
        firebaseMocks.onAuthStateChanged.mockImplementation((_auth, handler) => {
            void handler(user);
            return vi.fn();
        });

        checkAuth(callback);
        await vi.advanceTimersByTimeAsync(749);
        expect(profileRestMocks.loadAuthProfileViaRest).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await vi.advanceTimersByTimeAsync(1500);
        await Promise.resolve();
        await Promise.resolve();

        expect(callback).toHaveBeenCalledWith(expect.objectContaining({
            parentOf: [{ teamId: 'team-1', playerId: 'player-9' }]
        }));
        expect(dbMocks.getUserTeams).toHaveBeenCalledWith('parent-1');
    });

    it('preserves complete profile emptiness without forcing a second parent-profile read', async () => {
        const user = { uid: 'coach-1', email: 'coach@example.com' };
        const callback = vi.fn();
        dbMocks.getUserProfile.mockResolvedValue({ email: 'coach@example.com' });
        dbMocks.listMyParentMembershipRequests.mockResolvedValue([]);
        dbMocks.getUserTeams.mockResolvedValue([]);
        firebaseMocks.onAuthStateChanged.mockImplementation((_auth, handler) => {
            void handler(user);
            return vi.fn();
        });

        checkAuth(callback);
        await vi.waitFor(() => {
            expect(callback).toHaveBeenCalledWith(expect.objectContaining({ parentOf: [] }));
        });
    });

    it('preserves team media upload grants on the signed-in user profile', async () => {
        const user = {
            uid: 'parent-1',
            email: 'parent@example.com'
        };
        const callback = vi.fn();

        dbMocks.getUserProfile.mockResolvedValue({
            email: 'parent@example.com',
            roles: ['parent'],
            parentOf: [{ teamId: 'team-1', playerId: 'player-9' }],
            teamMediaUploadTeamIds: ['team-1', 42],
            mediaUploadTeamIds: ['legacy-team', null]
        });
        dbMocks.listMyParentMembershipRequests.mockResolvedValue([]);
        dbMocks.normalizeParentScopeLinks.mockResolvedValue({
            activeLinks: [{ teamId: 'team-1', playerId: 'player-9' }],
            parentTeamIds: ['team-1'],
            parentPlayerKeys: ['team-1::player-9']
        });
        dbMocks.getUserTeams.mockResolvedValue([]);
        firebaseMocks.onAuthStateChanged.mockImplementation(async (_auth, handler) => {
            await handler(user);
            return vi.fn();
        });

        await checkAuth(callback);

        const hydratedUser = callback.mock.calls[0][0];
        expect(hydratedUser).toEqual(expect.objectContaining({
            teamMediaUploadTeamIds: ['team-1'],
            mediaUploadTeamIds: ['legacy-team']
        }));
        expect(canContributeTeamMedia(hydratedUser, { id: 'team-1', ownerId: 'coach-1', adminEmails: [] })).toBe(true);
        expect(canContributeTeamMedia(hydratedUser, { id: 'legacy-team', ownerId: 'coach-1', adminEmails: [] })).toBe(true);
        expect(canContributeTeamMedia(hydratedUser, { id: 'other-team', ownerId: 'coach-1', adminEmails: [] })).toBe(false);
    });

    it('keeps a stale profile email separate when the current Auth email is empty', async () => {
        const user = { uid: 'parent-1', email: null };
        const callback = vi.fn();

        dbMocks.getUserProfile.mockResolvedValue({
            email: 'stale-admin@example.com',
            roles: ['parent']
        });
        dbMocks.listMyParentMembershipRequests.mockResolvedValue([]);
        dbMocks.getUserTeams.mockResolvedValue([]);
        firebaseMocks.onAuthStateChanged.mockImplementation(async (_auth, handler) => {
            await handler(user);
            return vi.fn();
        });

        await checkAuth(callback);

        expect(callback).toHaveBeenCalledWith(expect.objectContaining({
            email: null,
            profileEmail: 'stale-admin@example.com'
        }));
    });

    it('filters parent scope migrations down to active team and player links', async () => {
        const user = {
            uid: 'parent-1',
            email: 'parent@example.com'
        };
        const callback = vi.fn();

        dbMocks.getUserProfile.mockResolvedValue({
            email: 'parent@example.com',
            roles: ['parent'],
            parentOf: [
                { teamId: 'team-active', playerId: 'player-active' },
                { teamId: 'team-inactive', playerId: 'player-inactive' },
                { teamId: 'team-missing', playerId: 'player-missing' }
            ],
            parentTeamIds: ['team-active', 'team-inactive', 'team-missing'],
            parentPlayerKeys: ['team-active::player-active', 'team-inactive::player-inactive', 'team-missing::player-missing']
        });
        dbMocks.listMyParentMembershipRequests.mockResolvedValue([]);
        dbMocks.normalizeParentScopeLinks.mockResolvedValue({
            activeLinks: [{ teamId: 'team-active', playerId: 'player-active' }],
            parentTeamIds: ['team-active'],
            parentPlayerKeys: ['team-active::player-active']
        });
        dbMocks.updateUserProfile.mockResolvedValue(undefined);
        dbMocks.getUserTeams.mockResolvedValue([]);
        firebaseMocks.onAuthStateChanged.mockImplementation(async (_auth, handler) => {
            await handler(user);
            return vi.fn();
        });

        await checkAuth(callback);

        expect(dbMocks.normalizeParentScopeLinks).toHaveBeenCalledWith([
            { teamId: 'team-active', playerId: 'player-active' },
            { teamId: 'team-inactive', playerId: 'player-inactive' },
            { teamId: 'team-missing', playerId: 'player-missing' }
        ]);
        expect(dbMocks.updateUserProfile).toHaveBeenCalledWith('parent-1', {
            parentTeamIds: ['team-active'],
            parentPlayerKeys: ['team-active::player-active']
        });
        expect(callback).toHaveBeenCalledWith(expect.objectContaining({
            parentOf: expect.arrayContaining([
                expect.objectContaining({ teamId: 'team-active', playerId: 'player-active' }),
                expect.objectContaining({ teamId: 'team-inactive', playerId: 'player-inactive' })
            ])
        }));
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
        dbMocks.normalizeParentScopeLinks.mockResolvedValue({
            activeLinks: [{ teamId: 'team-1', playerId: 'player-9' }],
            parentTeamIds: ['team-1'],
            parentPlayerKeys: ['team-1::player-9']
        });
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

    it('waits within the access bound so a delayed membership repair reaches the callback', async () => {
        let resolveMembershipRequests;
        const user = { uid: 'parent-1', email: 'parent@example.com' };
        const callback = vi.fn();
        dbMocks.getUserProfile.mockResolvedValue({ email: 'parent@example.com', roles: ['member'] });
        dbMocks.listMyParentMembershipRequests.mockImplementation(() => new Promise((resolve) => {
            resolveMembershipRequests = resolve;
        }));
        dbMocks.getUserTeams.mockResolvedValue([]);
        dbMocks.updateUserProfile.mockResolvedValue(undefined);
        firebaseMocks.onAuthStateChanged.mockImplementation(async (_auth, handler) => {
            await handler(user);
            return vi.fn();
        });

        const authCheck = checkAuth(callback);
        await vi.waitFor(() => expect(resolveMembershipRequests).toBeTypeOf('function'));
        resolveMembershipRequests([{
            status: 'approved', requesterUserId: 'parent-1', teamId: 'team-2', playerId: 'player-2'
        }]);
        await authCheck;

        expect(callback).toHaveBeenCalledWith(expect.objectContaining({
            parentOf: [expect.objectContaining({ teamId: 'team-2', playerId: 'player-2' })]
        }));
    });

    it('waits within the access bound so delayed ownerId discovery reaches the callback', async () => {
        let resolveOwnedTeams;
        const user = { uid: 'coach-1', email: 'coach@example.com' };
        const callback = vi.fn();
        dbMocks.getUserProfile.mockResolvedValue({ email: 'coach@example.com' });
        dbMocks.listMyParentMembershipRequests.mockResolvedValue([]);
        dbMocks.getUserTeams.mockImplementation(() => new Promise((resolve) => {
            resolveOwnedTeams = resolve;
        }));
        firebaseMocks.onAuthStateChanged.mockImplementation(async (_auth, handler) => {
            await handler(user);
            return vi.fn();
        });

        const authCheck = checkAuth(callback);
        await vi.waitFor(() => expect(resolveOwnedTeams).toBeTypeOf('function'));
        resolveOwnedTeams([{ id: 'team-owned', name: 'Vipers' }]);
        await authCheck;

        expect(callback).toHaveBeenCalledWith(expect.objectContaining({ coachOf: ['team-owned'] }));
    });

    it('preserves stored coach access while ownerId discovery remains stalled', async () => {
        vi.useFakeTimers();
        const user = { uid: 'coach-stored', email: 'coach@example.com' };
        const callback = vi.fn();
        dbMocks.getUserProfile.mockResolvedValue({
            email: 'coach@example.com',
            roles: ['coach'],
            coachOf: ['team-stored']
        });
        dbMocks.listMyParentMembershipRequests.mockResolvedValue([]);
        dbMocks.getUserTeams.mockImplementation(() => new Promise(() => {}));
        firebaseMocks.onAuthStateChanged.mockImplementation(async (_auth, handler) => handler(user));

        const authCheck = checkAuth(callback);
        await vi.advanceTimersByTimeAsync(1500);
        await authCheck;

        expect(callback).toHaveBeenCalledWith(expect.objectContaining({ coachOf: ['team-stored'] }));
    });

    it('re-invokes the current callback with a membership repair that settles after the access timeout', async () => {
        vi.useFakeTimers();
        let resolveMembershipRequests;
        const user = { uid: 'parent-late', email: 'parent@example.com' };
        const callback = vi.fn();
        dbMocks.getUserProfile.mockResolvedValue({ email: 'parent@example.com', roles: ['member'] });
        dbMocks.listMyParentMembershipRequests.mockImplementation(() => new Promise((resolve) => {
            resolveMembershipRequests = resolve;
        }));
        dbMocks.getUserTeams.mockResolvedValue([]);
        dbMocks.updateUserProfile.mockResolvedValue(undefined);
        firebaseMocks.onAuthStateChanged.mockImplementation(async (_auth, handler) => handler(user));

        const authCheck = checkAuth(callback);
        await vi.advanceTimersByTimeAsync(1500);
        await authCheck;
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback.mock.calls[0][0].parentOf).toEqual([]);
        resolveMembershipRequests([{
            status: 'approved', requesterUserId: 'parent-late', teamId: 'team-late', playerId: 'player-late'
        }]);

        await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(2));
        expect(callback.mock.calls[1][0]).toEqual(expect.objectContaining({
            roles: ['member', 'parent'],
            parentOf: [expect.objectContaining({ teamId: 'team-late', playerId: 'player-late' })]
        }));
        expect(dbMocks.updateUserProfile).toHaveBeenCalledWith('parent-late', expect.objectContaining({
            parentOf: [expect.objectContaining({ teamId: 'team-late', playerId: 'player-late' })]
        }));
    });

    it('re-invokes the current callback with ownerId discovery that settles after the access timeout', async () => {
        vi.useFakeTimers();
        let resolveOwnedTeams;
        const user = { uid: 'coach-late', email: 'coach@example.com' };
        const callback = vi.fn();
        dbMocks.getUserProfile.mockResolvedValue({ email: 'coach@example.com' });
        dbMocks.listMyParentMembershipRequests.mockResolvedValue([]);
        dbMocks.getUserTeams.mockImplementation(() => new Promise((resolve) => {
            resolveOwnedTeams = resolve;
        }));
        firebaseMocks.onAuthStateChanged.mockImplementation(async (_auth, handler) => handler(user));

        const authCheck = checkAuth(callback);
        await vi.advanceTimersByTimeAsync(1500);
        await authCheck;
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback.mock.calls[0][0].coachOf).toBeUndefined();
        resolveOwnedTeams([{ id: 'team-late' }]);

        await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(2));
        expect(callback.mock.calls[1][0]).toEqual(expect.objectContaining({ coachOf: ['team-late'] }));
    });

    it('does not publish stale late access after the auth session changes', async () => {
        vi.useFakeTimers();
        let authHandler;
        let resolveMembershipRequests;
        const user = { uid: 'parent-old', email: 'parent@example.com' };
        const callback = vi.fn();
        dbMocks.getUserProfile.mockResolvedValue({ email: 'parent@example.com', roles: ['member'] });
        dbMocks.listMyParentMembershipRequests.mockImplementation(() => new Promise((resolve) => {
            resolveMembershipRequests = resolve;
        }));
        dbMocks.getUserTeams.mockResolvedValue([]);
        firebaseMocks.onAuthStateChanged.mockImplementation((_auth, handler) => {
            authHandler = handler;
            return vi.fn();
        });

        checkAuth(callback);
        const oldSessionCheck = authHandler(user);
        await vi.advanceTimersByTimeAsync(1500);
        await oldSessionCheck;
        await authHandler(null);
        expect(callback).toHaveBeenCalledTimes(2);

        resolveMembershipRequests([{
            status: 'approved', requesterUserId: 'parent-old', teamId: 'team-late', playerId: 'player-late'
        }]);
        await Promise.resolve();
        await Promise.resolve();

        expect(callback).toHaveBeenCalledTimes(2);
        expect(callback).toHaveBeenLastCalledWith(null);
    });
});
