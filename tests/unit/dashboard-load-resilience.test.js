import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

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

vi.mock('../../js/firebase.js?v=26', () => firebaseMocks);
vi.mock('../../js/db.js?v=4433176', () => dbMocks);
vi.mock('../../js/signup-flow.js?v=14', () => ({
    executeEmailPasswordSignup: vi.fn()
}));
vi.mock('../../js/admin-invite.js?v=9', () => ({
    redeemAdminInviteAcceptance: vi.fn()
}));

const { checkAuth } = await import('../../js/auth.js');

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

function emitSignedInUser(user) {
    firebaseMocks.onAuthStateChanged.mockImplementation((authInstance, handler) => {
        handler(user);
        return vi.fn();
    });
}

describe('dashboard load resilience', () => {
    describe('auth critical path', () => {
        beforeEach(() => {
            vi.clearAllMocks();
            firebaseMocks.auth.currentUser = null;
            dbMocks.listMyParentMembershipRequests.mockResolvedValue([]);
            dbMocks.normalizeParentScopeLinks.mockResolvedValue({
                activeLinks: [],
                parentTeamIds: [],
                parentPlayerKeys: []
            });
        });

        it('invokes the auth callback even while the parent scope migration is still running', async () => {
            // The migration is a background repair. Before it was deferred, a slow
            // or hanging normalize call held the callback - and every consumer
            // page's first render - indefinitely.
            dbMocks.normalizeParentScopeLinks.mockReturnValue(new Promise(() => {}));
            dbMocks.getUserProfile.mockResolvedValue({
                email: 'coach@example.com',
                parentOf: [{ teamId: 'team-1', playerId: 'player-1' }],
                coachOf: ['team-1']
            });

            const callback = vi.fn();
            emitSignedInUser({ uid: 'coach-1', email: 'coach@example.com' });

            checkAuth(callback);
            await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));

            expect(dbMocks.normalizeParentScopeLinks).toHaveBeenCalled();
        });

        it('starts the membership-request query without waiting for the profile read', async () => {
            let resolveProfile;
            dbMocks.getUserProfile.mockReturnValue(new Promise((resolve) => {
                resolveProfile = resolve;
            }));

            const callback = vi.fn();
            emitSignedInUser({ uid: 'coach-1', email: 'coach@example.com' });

            checkAuth(callback);
            await Promise.resolve();

            // Both reads are independent, so the second must already be in flight
            // while the first is still pending.
            expect(dbMocks.listMyParentMembershipRequests).toHaveBeenCalledTimes(1);

            resolveProfile({ email: 'coach@example.com', coachOf: ['team-1'] });
            await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
        });

        it('hands the profile it already read to the callback', async () => {
            const profile = { email: 'coach@example.com', isAdmin: true, coachOf: ['team-1'] };
            dbMocks.getUserProfile.mockResolvedValue(profile);

            const callback = vi.fn();
            emitSignedInUser({ uid: 'coach-1', email: 'coach@example.com' });

            checkAuth(callback);
            await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));

            expect(callback).toHaveBeenCalledWith(
                expect.objectContaining({ uid: 'coach-1', isAdmin: true }),
                expect.objectContaining({ isAdmin: true })
            );
        });

        it('passes a null user through without reading a profile', async () => {
            const callback = vi.fn();
            emitSignedInUser(null);

            checkAuth(callback);
            await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));

            expect(dbMocks.getUserProfile).not.toHaveBeenCalled();
            expect(callback).toHaveBeenCalledWith(null, null);
        });
    });

    describe('dashboard.html rendering', () => {
        const html = readRepoFile('dashboard.html');

        it('paints the nav before the auth round trips resolve', () => {
            const earlyRender = html.indexOf("renderHeader(document.getElementById('header-container'), null);");
            const authGate = html.indexOf('const { user, profile } = await requireSyncedAuth();');

            expect(earlyRender).toBeGreaterThan(-1);
            expect(authGate).toBeGreaterThan(-1);
            expect(earlyRender).toBeLessThan(authGate);
        });

        it('re-renders the nav once the signed-in user is known', () => {
            expect(html).toContain("renderHeader(document.getElementById('header-container'), user);");
        });

        it('does not re-read the profile that checkAuth already fetched', () => {
            expect(html).not.toContain('getUserProfile(user.uid)');
            expect(html).not.toContain('getUserProfile');
        });

        it('replaces the loading spinner with an actionable error state', () => {
            expect(html).toContain('function renderLoadError()');
            expect(html).toContain('teams-load-error');
            expect(html).toContain("Couldn't load your teams");
            expect(html).toContain('retry-load-teams');
            // The retry has to actually re-run the load, not just clear the message.
            expect(html).toContain('renderLoadingState(container);');
            expect(html).toContain('init();');
        });

        it('keeps the auth redirect path from rendering a load error', () => {
            expect(html).toContain("if (error === 'Not authenticated') return;");
        });

        it('renders teams without waiting on unread chat counts', () => {
            const countsRequested = html.indexOf('const unreadCountsReady = teamIds.length > 0');
            const patchApplied = html.indexOf('unreadCountsReady.then((counts) => {');
            const firstGridRender = html.indexOf('fullAccessTeams.map(team => renderTeamCard');

            expect(countsRequested).toBeGreaterThan(-1);
            expect(firstGridRender).toBeGreaterThan(-1);
            // Counts are requested before the grid renders but only applied after.
            expect(countsRequested).toBeLessThan(firstGridRender);
            expect(patchApplied).toBeGreaterThan(firstGridRender);
        });

        it('degrades to no badge when the unread count lookup fails', () => {
            expect(html).toContain("console.warn('Failed to load unread chat counts:', err);");
            expect(html).toContain('return {};');
        });

        it('exposes the markers the badge patch needs', () => {
            expect(html).toContain('data-team-chat-link="${team.id}"');
            expect(html).toContain('data-team-chat-icon');
            expect(html).toContain('data-team-chat-label');
            expect(html).toContain('data-unread-badge');
        });
    });
});
