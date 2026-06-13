import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
    getTeams: vi.fn()
}));

const homeMocks = vi.hoisted(() => ({
    loadParentHome: vi.fn(),
    loadParentHomeSummary: vi.fn()
}));

const firebaseMocks = vi.hoisted(() => ({
    db: {},
    collection: vi.fn((db, collectionName) => ({ db, collectionName })),
    collectionGroup: vi.fn((db, collectionName) => ({ db, collectionName })),
    doc: vi.fn((db, ...pathSegments) => ({ db, path: pathSegments.join('/') })),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    query: vi.fn((...parts) => ({ parts })),
    where: vi.fn((field, op, value) => ({ type: 'where', field, op, value })),
    orderBy: vi.fn((field) => ({ type: 'orderBy', field })),
    limit: vi.fn((count) => ({ type: 'limit', count }))
}));

const helpMocks = vi.hoisted(() => ({
    getSearchHelpRoles: vi.fn((role) => role && role !== 'all' ? [role] : ['admin', 'coach', 'member', 'parent']),
    searchHelpKnowledge: vi.fn()
}));

vi.mock('../../js/db.js', () => dbMocks);
vi.mock('../../js/firebase.js', () => firebaseMocks);
vi.mock('../../apps/app/src/lib/homeService.ts', () => homeMocks);
vi.mock('../../apps/app/src/lib/helpKnowledgeService.ts', () => helpMocks);

import {
    buildAppSearchActions,
    computeAppSearchResults,
    getKnownAppSearchTeams,
    getSearchHelpRoles,
    loadAppSearchTeams,
    resetAppSearchCacheForTests,
    scoreSearchText,
    searchAppTeams,
    searchAppPlayers,
    splitSearchTokens
} from '../../apps/app/src/lib/searchService.ts';

const auth = {
    user: {
        uid: 'user-1',
        email: 'parent@example.com',
        displayName: 'Pat Parent',
        roles: ['parent'],
        parentOf: [{ teamId: 'team-home', playerId: 'player-home' }]
    },
    isAdmin: false,
    isPlatformAdmin: false
};

function firestorePlayer(path, data) {
    return {
        id: path.split('/').pop(),
        ref: { path },
        data: () => data
    };
}

function firestoreTeam(id, data) {
    return {
        id,
        ref: { path: `teams/${id}` },
        data: () => data
    };
}

function firestoreDocument(id, data, exists = true) {
    return {
        id,
        exists: () => exists,
        data: () => data
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    firebaseMocks.getDoc.mockReset();
    resetAppSearchCacheForTests();
    helpMocks.searchHelpKnowledge.mockReturnValue([]);
    homeMocks.loadParentHomeSummary.mockImplementation((...args) => homeMocks.loadParentHome(...args));
});

describe('React app search service', () => {
    it('builds current-site style actions for signed out, signed in, and admin users', () => {
        const signedOutActions = buildAppSearchActions({ user: null, isAdmin: false, isPlatformAdmin: false });
        expect(signedOutActions.map((item) => item.id)).toEqual([
            'browse-teams',
            'sign-in',
            'get-started'
        ]);
        expect(signedOutActions[0]).toMatchObject({
            id: 'browse-teams',
            href: 'https://allplays.ai/teams.html'
        });
        expect(signedOutActions[0].route).toBeUndefined();

        const signedInActions = buildAppSearchActions(auth);
        expect(signedInActions.map((item) => item.id)).toEqual([
            'browse-teams',
            'dashboard',
            'my-teams',
            'schedule',
            'messages',
            'social-feed',
            'find-friends',
            'create-social-post',
            'profile'
        ]);
        expect(signedInActions[0]).toMatchObject({
            id: 'browse-teams',
            route: '/teams/browse'
        });
        expect(signedInActions[0].href).toBeUndefined();

        expect(buildAppSearchActions({ ...auth, isAdmin: true }).map((item) => item.id)).toContain('admin-dashboard');
    });

    it('scores and filters actions, teams, and players with the same token rules as website search', () => {
        expect(splitSearchTokens('  Pat   Star  ')).toEqual(['pat', 'star']);
        expect(scoreSearchText('Pat Star', ['pat'])).toBeGreaterThan(scoreSearchText('The Pat Star', ['pat']));
        expect(scoreSearchText('Pat Star', ['missing'])).toBe(-1);

        const manyTeams = Array.from({ length: 25 }, (_, index) => ({
            id: `team-${index}`,
            name: `Bear Team ${index}`,
            sport: 'Soccer',
            zip: '66210',
            isPublic: true
        }));
        const manyPlayers = Array.from({ length: 25 }, (_, index) => ({
            id: `player:team-1:player-${index}`,
            kind: 'player',
            title: `Bear Player ${index}`,
            subtitle: 'Bears',
            route: `/players/team-1/player-${index}`,
            teamId: 'team-1',
            playerId: `player-${index}`
        }));

        const results = computeAppSearchResults({
            queryText: 'bear',
            auth,
            teams: [
                { id: 'team-1', name: 'Bears', sport: 'Basketball', zip: '66210', isPublic: true },
                { id: 'team-2', name: 'Rockets', sport: 'Soccer', zip: '64114', isPublic: true },
                ...manyTeams
            ],
            players: [
                {
                    id: 'player:team-1:player-1',
                    kind: 'player',
                    title: '#9 Pat Bear',
                    subtitle: 'Bears',
                    route: '/players/team-1/player-1',
                    teamId: 'team-1',
                    playerId: 'player-1'
                },
                ...manyPlayers
            ]
        });

        expect(results.teams).toHaveLength(20);
        expect(results.teams[0].title).toBe('Bears');
        expect(results.players).toHaveLength(20);
        expect(results.players[0].title).toBe('#9 Pat Bear');
        expect(results.flat.map((item) => item.kind)).toEqual([
            ...Array(20).fill('team'),
            ...Array(20).fill('player')
        ]);

        const defaultResults = computeAppSearchResults({
            queryText: '',
            auth,
            teams: manyTeams,
            players: manyPlayers
        });
        expect(defaultResults.actions.map((item) => item.id)).toEqual(['browse-teams', 'dashboard', 'my-teams', 'schedule', 'messages', 'social-feed', 'find-friends', 'create-social-post', 'profile']);
        expect(defaultResults.teams).toHaveLength(20);
        expect(defaultResults.players).toHaveLength(20);
    });

    it('translates help role filters without affecting non-help search results', () => {
        expect(getSearchHelpRoles(auth, 'All')).toEqual(['parent', 'coach', 'admin', 'platformAdmin', 'member']);
        expect(getSearchHelpRoles(auth, 'Coach')).toEqual(['coach']);
        expect(getSearchHelpRoles(auth, 'Member')).toEqual(['member']);
        expect(getSearchHelpRoles({ ...auth, roles: ['coach'], isCoach: true, isParent: true })).toEqual(['coach', 'parent']);

        helpMocks.searchHelpKnowledge.mockReturnValue([{
            id: 'coach-schedule',
            title: 'Plan Schedule',
            file: 'workflow-schedule.html',
            url: 'https://allplays.ai/workflow-schedule.html',
            roles: ['coach', 'admin'],
            summary: 'Schedule games and practices.',
            snippet: 'Coach and admin scheduling guidance.',
            score: 38
        }]);

        const teams = [{ id: 'team-1', name: 'Schedule Bears', sport: 'Basketball', isPublic: true }];
        const players = [{
            id: 'player:team-1:player-1',
            kind: 'player',
            title: 'Schedule Striker',
            subtitle: 'Schedule Bears',
            route: '/players/team-1/player-1',
            teamId: 'team-1',
            playerId: 'player-1'
        }];
        const withoutFilter = computeAppSearchResults({
            queryText: 'schedule',
            auth,
            teams,
            players
        });
        const withCoachFilter = computeAppSearchResults({
            queryText: 'schedule',
            auth,
            teams,
            players,
            helpRoleFilter: 'Coach'
        });

        expect(helpMocks.searchHelpKnowledge).toHaveBeenLastCalledWith({
            query: 'schedule',
            roles: ['coach'],
            limit: 5
        });
        expect(withoutFilter.teams).toEqual(withCoachFilter.teams);
        expect(withoutFilter.players).toEqual(withCoachFilter.players);
        expect(withoutFilter.actions).toEqual(withCoachFilter.actions);
        expect(withCoachFilter.help[0]).toMatchObject({
            id: 'help:coach-schedule',
            roles: ['coach', 'admin']
        });
    });

    it('adds limited help results for meaningful queries without changing app result ordering', () => {
        helpMocks.searchHelpKnowledge.mockReturnValue([{
            id: 'account-password-reset',
            title: 'Reset a password',
            file: 'help-account.html',
            url: 'https://allplays.ai/help-account.html',
            roles: ['parent', 'coach'],
            summary: 'Recover account access.',
            snippet: 'Use password reset when a parent or coach cannot sign in.',
            score: 42
        }]);

        const shortResults = computeAppSearchResults({
            queryText: 'p',
            auth,
            teams: [{ id: 'team-1', name: 'Panthers', sport: 'Basketball', isPublic: true }],
            players: []
        });
        expect(shortResults.help).toEqual([]);
        expect(helpMocks.searchHelpKnowledge).not.toHaveBeenCalled();

        const results = computeAppSearchResults({
            queryText: 'password reset',
            auth,
            teams: [{ id: 'team-1', name: 'Password Reset Rockets', sport: 'Basketball', isPublic: true }],
            players: [{
                id: 'player:team-1:player-1',
                kind: 'player',
                title: 'Reset Runner',
                subtitle: 'Password Reset Rockets',
                route: '/players/team-1/player-1',
                teamId: 'team-1',
                playerId: 'player-1'
            }]
        });

        expect(helpMocks.searchHelpKnowledge).toHaveBeenCalledWith({
            query: 'password reset',
            roles: ['parent'],
            roleFilter: 'all',
            limit: 5
        });
        expect(results.help).toEqual([{
            id: 'help:account-password-reset',
            kind: 'help',
            title: 'Reset a password',
            subtitle: 'Use password reset when a parent or coach cannot sign in.',
            route: '/help/account-password-reset',
            href: 'https://allplays.ai/help-account.html',
            roles: ['parent', 'coach'],
            snippet: 'Use password reset when a parent or coach cannot sign in.'
        }]);
        expect(results.flat.map((item) => item.kind)).toEqual(['team', 'help', 'player']);
    });

    it('builds already-known app-access teams from auth without loading Firestore', () => {
        const teams = getKnownAppSearchTeams({
            ...auth.user,
            parentOf: [
                { teamId: 'team-bears', teamName: 'Bears', sport: 'Basketball', active: true },
                { teamId: 'team-archived', teamName: 'Old Bears', sport: 'Soccer', archived: true },
                { teamId: '', teamName: 'Missing Id' }
            ]
        });

        expect(teams).toEqual([expect.objectContaining({
            id: 'team-bears',
            name: 'Bears',
            sport: 'Basketball',
            fromAppAccess: true
        })]);
        expect(dbMocks.getTeams).not.toHaveBeenCalled();
        expect(firebaseMocks.getDocs).not.toHaveBeenCalled();
        expect(homeMocks.loadParentHomeSummary).not.toHaveBeenCalled();
    });

    it('passes the optional help role filter only to help search results', () => {
        const helpDocs = [{
            id: 'parent-guide',
            title: 'Parent guide',
            file: 'help-parent.html',
            url: 'https://allplays.ai/help-parent.html',
            roles: ['parent'],
            summary: 'Help for parents.',
            snippet: 'Help for parents.',
            score: 10
        }, {
            id: 'coach-guide',
            title: 'Coach guide',
            file: 'help-coach.html',
            url: 'https://allplays.ai/help-coach.html',
            roles: ['coach'],
            summary: 'Help for coaches.',
            snippet: 'Help for coaches.',
            score: 9
        }];
        helpMocks.searchHelpKnowledge.mockImplementation(({ roleFilter }) => (
            roleFilter === 'coach' ? helpDocs.filter((doc) => doc.roles.includes('coach')) : helpDocs
        ));

        const baseSearchInput = {
            queryText: 'guide',
            auth,
            teams: [{ id: 'team-1', name: 'Guide Bears', sport: 'Basketball', isPublic: true }],
            players: [{
                id: 'player:team-1:player-1',
                kind: 'player',
                title: 'Guide Runner',
                subtitle: 'Guide Bears',
                route: '/players/team-1/player-1',
                teamId: 'team-1',
                playerId: 'player-1'
            }]
        };

        const allResults = computeAppSearchResults({ ...baseSearchInput, helpRoleFilter: 'all' });
        const coachResults = computeAppSearchResults({ ...baseSearchInput, helpRoleFilter: 'coach' });
        const nonHelpByKind = (results) => ({
            action: results.flat.filter((item) => item.kind === 'action'),
            team: results.flat.filter((item) => item.kind === 'team'),
            player: results.flat.filter((item) => item.kind === 'player'),
            social: results.flat.filter((item) => item.kind === 'social')
        });

        expect(helpMocks.searchHelpKnowledge).toHaveBeenLastCalledWith({
            query: 'guide',
            roles: ['parent'],
            roleFilter: 'coach',
            limit: 5
        });
        expect(allResults.help.map((item) => item.title)).toEqual(['Parent guide', 'Coach guide']);
        expect(coachResults.help.map((item) => item.title)).toEqual(['Coach guide']);
        expect(nonHelpByKind(coachResults)).toEqual(nonHelpByKind(allResults));
        expect(coachResults.teams.map((item) => item.title)).toEqual(['Guide Bears']);
        expect(coachResults.players.map((item) => item.title)).toEqual(['Guide Runner']);

    });

    it('maps platform admin help searches to admin help docs', () => {
        const adminDoc = {
            id: 'admin-guide',
            title: 'Admin guide',
            file: 'help-admin.html',
            url: 'https://allplays.ai/help-admin.html',
            roles: ['admin'],
            summary: 'Help for admins.',
            snippet: 'Help for admins.',
            score: 10
        };
        helpMocks.searchHelpKnowledge.mockImplementation(({ roleFilter }) => (
            roleFilter === 'admin' ? [adminDoc] : []
        ));

        const results = computeAppSearchResults({
            queryText: 'guide',
            auth: {
                ...auth,
                user: { ...auth.user, roles: ['platformAdmin'] },
                isPlatformAdmin: true
            },
            teams: [],
            players: [],
            helpRoleFilter: 'platformAdmin'
        });

        expect(helpMocks.searchHelpKnowledge).toHaveBeenCalledWith({
            query: 'guide',
            roles: ['admin'],
            roleFilter: 'admin',
            limit: 5
        });
        expect(results.help.map((item) => item.title)).toEqual(['Admin guide']);
    });

    it('passes selected help roles and excludes nonmatching help results', () => {
        helpMocks.searchHelpKnowledge.mockReturnValue([
            {
                id: 'live-tracker-coach-guide',
                title: 'Track Live Games with the Live Tracker',
                file: 'help-live-tracker.html',
                url: 'https://allplays.ai/help-live-tracker.html',
                roles: ['coach', 'admin'],
                summary: 'Use the live tracker from tip-off to final buzzer.',
                snippet: 'Coaches and admins can run live tracker game flows.',
                score: 42
            },
            {
                id: 'watch-live-games',
                title: 'Watch Live Games and Replays',
                file: 'help-watch-chat.html',
                url: 'https://allplays.ai/help-watch-chat.html',
                roles: ['parent', 'member'],
                summary: 'Open a game and follow it live.',
                snippet: 'Parents and members can watch live games and replay links.',
                score: 21
            }
        ]);

        const results = computeAppSearchResults({
            queryText: 'live tracker',
            auth,
            teams: [],
            players: [],
            helpRoleFilter: 'member'
        });

        expect(helpMocks.searchHelpKnowledge).toHaveBeenCalledWith({
            query: 'live tracker',
            roles: ['parent'],
            roleFilter: 'member',
            limit: 5
        });
        expect(results.help.map((item) => item.title)).toEqual(['Watch Live Games and Replays']);
    });

    it('loads app-access teams without bootstrapping the public catalog', async () => {
        homeMocks.loadParentHome.mockResolvedValue({
            teams: [{
                teamId: 'team-home',
                teamName: 'Home Rockets',
                sport: 'Basketball',
                photoUrl: 'https://img.example.test/home.png',
                players: [],
                nextEvent: null,
                eventCount: 0,
                unreadCount: 0,
                openActions: 0
            }, {
                teamId: 'team-inactive-access',
                teamName: 'Inactive Access',
                sport: 'Soccer',
                active: false,
                players: [],
                nextEvent: null,
                eventCount: 0,
                unreadCount: 0,
                openActions: 0
            }, {
                teamId: 'team-archived-access',
                teamName: 'Archived Access',
                sport: 'Soccer',
                archived: true,
                players: [],
                nextEvent: null,
                eventCount: 0,
                unreadCount: 0,
                openActions: 0
            }, {
                teamId: 'team-status-archived-access',
                teamName: 'Archived Status Access',
                sport: 'Soccer',
                status: 'archived',
                players: [],
                nextEvent: null,
                eventCount: 0,
                unreadCount: 0,
                openActions: 0
            }]
        });
        firebaseMocks.getDocs
            .mockResolvedValueOnce({ docs: [firestoreTeam('team-owner', { name: 'Owner Eagles', sport: 'Volleyball', isPublic: false, ownerId: 'user-1' })] })
            .mockResolvedValueOnce({ docs: [firestoreTeam('team-admin', { name: 'Admin Lions', sport: 'Soccer', isPublic: false, adminEmails: ['parent@example.com'] })] })
            .mockResolvedValueOnce({ docs: [] })
            .mockResolvedValueOnce({ docs: [] });
        firebaseMocks.getDoc.mockResolvedValueOnce(firestoreDocument('team-home', {
            name: 'Home Rockets',
            sport: 'Basketball',
            isPublic: false,
            active: true
        }));
        const teams = await loadAppSearchTeams(auth.user);

        expect(teams.map((team) => team.id)).toEqual(['team-admin', 'team-home', 'team-owner']);
        expect(teams.find((team) => team.id === 'team-home')).toMatchObject({
            name: 'Home Rockets',
            fromAppAccess: true,
            photoUrl: 'https://img.example.test/home.png'
        });
        expect(teams.find((team) => team.id === 'team-inactive-access')).toBeUndefined();
        expect(teams.find((team) => team.id === 'team-archived-access')).toBeUndefined();
        expect(teams.find((team) => team.id === 'team-status-archived-access')).toBeUndefined();
        expect(dbMocks.getTeams).not.toHaveBeenCalled();
    });

    it('validates parent home fallback teams against Firestore visibility before adding them', async () => {
        homeMocks.loadParentHome.mockResolvedValue({
            teams: [
                { teamId: 'team-active-private', teamName: 'Active Private', sport: 'Basketball' },
                { teamId: 'team-archived-doc', teamName: 'Archived Doc', sport: 'Soccer' },
                { teamId: 'team-inactive-doc', teamName: 'Inactive Doc', sport: 'Baseball' },
                { teamId: 'team-missing-doc', teamName: 'Missing Doc', sport: 'Softball' }
            ]
        });
        firebaseMocks.getDoc
            .mockResolvedValueOnce(firestoreDocument('team-active-private', {
                name: 'Stored Active Private',
                sport: 'Basketball',
                isPublic: false,
                active: true,
                archived: false,
                status: 'active'
            }))
            .mockResolvedValueOnce(firestoreDocument('team-archived-doc', {
                name: 'Stored Archived',
                sport: 'Soccer',
                isPublic: false,
                archived: true
            }))
            .mockResolvedValueOnce(firestoreDocument('team-inactive-doc', {
                name: 'Stored Inactive',
                sport: 'Baseball',
                isPublic: false,
                active: false
            }))
            .mockResolvedValueOnce(firestoreDocument('team-missing-doc', {}, false));

        const teams = await loadAppSearchTeams(auth.user);

        expect(firebaseMocks.doc).toHaveBeenCalledWith(firebaseMocks.db, 'teams', 'team-active-private');
        expect(firebaseMocks.doc).toHaveBeenCalledWith(firebaseMocks.db, 'teams', 'team-archived-doc');
        expect(firebaseMocks.doc).toHaveBeenCalledWith(firebaseMocks.db, 'teams', 'team-inactive-doc');
        expect(firebaseMocks.doc).toHaveBeenCalledWith(firebaseMocks.db, 'teams', 'team-missing-doc');
        expect(teams.map((team) => team.id)).toEqual(['team-active-private']);
        expect(teams[0]).toMatchObject({
            id: 'team-active-private',
            name: 'Active Private',
            isPublic: false,
            fromAppAccess: true
        });
    });

    it('loads private selected stream-volunteer teams before checking search access', async () => {
        homeMocks.loadParentHome.mockResolvedValue({ teams: [] });
        firebaseMocks.getDocs
            .mockResolvedValueOnce({ docs: [] })
            .mockResolvedValueOnce({ docs: [] })
            .mockResolvedValueOnce({
                docs: [firestoreTeam('team-stream-member', {
                    name: 'Stream Member Bears',
                    sport: 'Soccer',
                    isPublic: false,
                    teamPermissions: {
                        streaming: {
                            mode: 'selected',
                            memberIds: ['user-1']
                        }
                    }
                })]
            })
            .mockResolvedValueOnce({
                docs: [firestoreTeam('team-stream-email', {
                    name: 'Stream Email Wolves',
                    sport: 'Basketball',
                    isPublic: false,
                    streamAccessMode: 'selected_volunteers',
                    streamVolunteerEmails: ['parent@example.com']
                })]
            });

        const teams = await loadAppSearchTeams(auth.user);

        expect(firebaseMocks.collection).toHaveBeenCalledWith(firebaseMocks.db, 'teams');
        expect(firebaseMocks.where).toHaveBeenCalledWith('teamPermissions.streaming.memberIds', 'array-contains', 'user-1');
        expect(firebaseMocks.where).toHaveBeenCalledWith('streamVolunteerEmails', 'array-contains', 'parent@example.com');
        expect(teams.map((team) => team.id)).toEqual(['team-stream-email', 'team-stream-member']);
    });

    it('lets selected stream volunteers discover private teams by uid or legacy email only', async () => {
        homeMocks.loadParentHome.mockResolvedValue({ teams: [] });
        firebaseMocks.getDocs
            .mockResolvedValueOnce({ docs: [] })
            .mockResolvedValueOnce({ docs: [] })
            .mockResolvedValueOnce({
                docs: [firestoreTeam('team-stream-member', {
                    name: 'Stream Member Bears',
                    sport: 'Soccer',
                    isPublic: false,
                    teamPermissions: { streaming: { mode: 'selected', memberIds: ['user-1'] } }
                })]
            })
            .mockResolvedValueOnce({
                docs: [firestoreTeam('team-stream-email', {
                    name: 'Stream Email Wolves',
                    sport: 'Basketball',
                    isPublic: false,
                    streamAccessMode: 'selected_volunteers',
                    streamVolunteerEmails: ['Parent@Example.com']
                })]
            });

        const teams = await loadAppSearchTeams(auth.user);

        expect(teams.map((team) => team.id)).toEqual(['team-stream-email', 'team-stream-member']);

        const unrelatedUser = { ...auth.user, uid: 'unrelated-user', email: 'unrelated@example.com', parentOf: [] };
        firebaseMocks.getDocs
            .mockResolvedValueOnce({ docs: [] })
            .mockResolvedValueOnce({ docs: [] })
            .mockResolvedValueOnce({ docs: [] })
            .mockResolvedValueOnce({ docs: [] });
        const unrelatedTeams = await loadAppSearchTeams(unrelatedUser);
        expect(unrelatedTeams).toEqual([]);

        const signedOutTeams = await loadAppSearchTeams(null);
        expect(signedOutTeams).toEqual([]);
    });

    it('caches loaded teams and falls back to app access when public team loading fails', async () => {
        homeMocks.loadParentHome.mockResolvedValue({
            teams: [{ teamId: 'team-home', teamName: 'Home Rockets', sport: 'Basketball' }]
        });
        firebaseMocks.getDocs
            .mockResolvedValueOnce({ docs: [] })
            .mockResolvedValueOnce({ docs: [] })
            .mockResolvedValueOnce({ docs: [] })
            .mockResolvedValueOnce({ docs: [] });
        firebaseMocks.getDoc.mockResolvedValueOnce(firestoreDocument('team-home', {
            name: 'Home Rockets',
            sport: 'Basketball',
            isPublic: false,
            active: true
        }));

        const first = await loadAppSearchTeams(auth.user);
        const second = await loadAppSearchTeams(auth.user);

        expect(second).toBe(first);
        expect(homeMocks.loadParentHomeSummary).toHaveBeenCalledTimes(1);
        expect(first.map((team) => team.id)).toEqual(['team-home']);

        resetAppSearchCacheForTests();
        firebaseMocks.getDocs
            .mockRejectedValueOnce(new Error('direct access down'))
            .mockResolvedValueOnce({ docs: [] })
            .mockResolvedValueOnce({ docs: [] })
            .mockResolvedValueOnce({ docs: [] });
        homeMocks.loadParentHome.mockResolvedValueOnce({
            teams: [{ teamId: 'team-private-access', teamName: 'Private Access', sport: 'Soccer' }]
        });
        firebaseMocks.getDoc.mockResolvedValueOnce(firestoreDocument('team-private-access', {
            name: 'Private Access',
            sport: 'Soccer',
            isPublic: false,
            active: true
        }));

        await expect(loadAppSearchTeams(auth.user)).resolves.toMatchObject([
            { id: 'team-private-access', name: 'Private Access', fromAppAccess: true }
        ]);
    });

    it('throws the first team loading error when no searchable team source succeeds', async () => {
        firebaseMocks.getDocs
            .mockRejectedValueOnce(new Error('direct access down'))
            .mockRejectedValueOnce(new Error('admin access down'))
            .mockRejectedValueOnce(new Error('stream member down'))
            .mockRejectedValueOnce(new Error('stream email down'));
        homeMocks.loadParentHome.mockRejectedValueOnce(new Error('home down'));

        await expect(loadAppSearchTeams(auth.user)).rejects.toThrow('direct access down');
    });

    it('searches teams by public-only bounded prefix queries and merges app-access teams locally', async () => {
        firebaseMocks.getDocs
            .mockResolvedValueOnce({
                docs: [
                    firestoreTeam('team-public', { name: 'Bears', sport: 'Basketball', isPublic: true }),
                    firestoreTeam('team-private-hidden', { name: 'Bear Den', sport: 'Soccer', isPublic: false })
                ]
            })
            .mockResolvedValueOnce({ docs: [] });

        const teams = await searchAppTeams('be', [{ id: 'team-home', name: 'Bearcats', sport: 'Soccer', fromAppAccess: true }], auth.user);

        expect(firebaseMocks.limit).toHaveBeenCalledWith(20);
        expect(firebaseMocks.where).toHaveBeenCalledWith('isPublic', '==', true);
        expect(teams.map((team) => team.id)).toEqual(['team-home', 'team-public']);
        expect(teams.find((team) => team.id === 'team-private-hidden')).toBeUndefined();
    });

    it('searches players only within visible team collections and filters local results', async () => {
        const visibleTeams = new Map([
            ['team-1', { id: 'team-1', name: 'Bears', sport: 'Basketball', fromAppAccess: true }],
            ['team-private', { id: 'team-private', name: 'Private', sport: 'Soccer', isPublic: false }]
        ]);
        firebaseMocks.getDocs.mockResolvedValue({
            docs: [
                firestorePlayer('teams/team-1/players/player-1', { name: 'Pat Star', number: '9' }),
                firestorePlayer('teams/team-1/players/player-1', { name: 'Pat Star', number: '9' }),
                firestorePlayer('teams/team-private/players/player-2', { name: 'Pat Secret', number: '10' })
            ]
        });

        const shortQuery = await searchAppPlayers('p', visibleTeams, auth.user);
        expect(shortQuery).toEqual([]);
        expect(firebaseMocks.getDocs).not.toHaveBeenCalled();

        const players = await searchAppPlayers('pat', visibleTeams, auth.user);

        expect(firebaseMocks.collectionGroup).not.toHaveBeenCalled();
        expect(firebaseMocks.collection).toHaveBeenCalledWith(firebaseMocks.db, 'teams/team-1/players');
        expect(firebaseMocks.collection).not.toHaveBeenCalledWith(firebaseMocks.db, 'teams/team-private/players');
        expect(firebaseMocks.getDocs).toHaveBeenCalled();
        expect(players).toEqual([{
            id: 'player:team-1:player-1',
            kind: 'player',
            title: '#9 Pat Star',
            subtitle: 'Bears',
            route: '/players/team-1/player-1',
            teamId: 'team-1',
            playerId: 'player-1'
        }]);
    });

    it('caps player-search fan-out to the top ranked searchable teams', async () => {
        const visibleTeams = new Map(Array.from({ length: 12 }, (_, index) => [
            `team-${index}`,
            {
                id: `team-${index}`,
                name: `Bear Team ${index}`,
                sport: 'Basketball',
                isPublic: true
            }
        ]));
        firebaseMocks.getDocs.mockResolvedValue({ docs: [] });

        await searchAppPlayers('bear', visibleTeams, auth.user);

        const playerCollectionPaths = firebaseMocks.collection.mock.calls
            .map(([, path]) => path)
            .filter((path) => String(path).endsWith('/players'));
        const uniquePlayerCollections = Array.from(new Set(playerCollectionPaths));

        expect(uniquePlayerCollections).toHaveLength(8);
        expect(firebaseMocks.getDocs).toHaveBeenCalledTimes(16);
        expect(uniquePlayerCollections).toEqual(Array.from({ length: 8 }, (_, index) => `teams/team-${index}/players`));
    });

    it('reuses cached broader player prefixes for narrower refinements when local filtering is sufficient', async () => {
        const visibleTeams = new Map([
            ['team-1', { id: 'team-1', name: 'Bears', sport: 'Basketball', fromAppAccess: true }]
        ]);
        firebaseMocks.getDocs.mockImplementation(async (request) => {
            const lowerBound = request.parts.find((part) => part?.type === 'where' && part.field === 'name' && part.op === '>=')?.value;
            if (lowerBound === 'pa' || lowerBound === 'Pa') {
                return {
                    docs: [
                        firestorePlayer('teams/team-1/players/player-1', { name: 'Pat Star', number: '9' }),
                        firestorePlayer('teams/team-1/players/player-2', { name: 'Pat Stone', number: '10' }),
                        firestorePlayer('teams/team-1/players/player-3', { name: 'Paige Forward', number: '11' })
                    ]
                };
            }
            if (lowerBound === 's' || lowerBound === 'S') {
                return {
                    docs: [
                        firestorePlayer('teams/team-1/players/player-1', { name: 'Pat Star', number: '9' }),
                        firestorePlayer('teams/team-1/players/player-2', { name: 'Pat Stone', number: '10' }),
                        firestorePlayer('teams/team-1/players/player-4', { name: 'Sam Patton', number: '12' })
                    ]
                };
            }

            throw new Error(`Unexpected player query: ${lowerBound}`);
        });

        const broaderPlayers = await searchAppPlayers('pa', visibleTeams, auth.user);
        expect(firebaseMocks.getDocs).toHaveBeenCalledTimes(2);
        expect(broaderPlayers.map((player) => player.title)).toEqual([
            '#9 Pat Star',
            '#10 Pat Stone',
            '#11 Paige Forward'
        ]);

        const narrowerPlayers = await searchAppPlayers('pat', visibleTeams, auth.user);
        expect(firebaseMocks.getDocs).toHaveBeenCalledTimes(2);
        expect(narrowerPlayers.map((player) => player.title)).toEqual([
            '#9 Pat Star',
            '#10 Pat Stone'
        ]);

        const callsBeforeMultiToken = firebaseMocks.getDocs.mock.calls.length;
        const multiTokenPlayers = await searchAppPlayers('pat s', visibleTeams, auth.user);
        expect(firebaseMocks.collectionGroup).not.toHaveBeenCalled();
        expect(firebaseMocks.getDocs.mock.calls.length - callsBeforeMultiToken).toBe(4);
        expect(multiTokenPlayers.map((player) => player.title)).toEqual([
            '#9 Pat Star',
            '#10 Pat Stone',
            '#12 Sam Patton'
        ]);
    });

    it('returns players from private selected-stream teams for eligible users only', async () => {
        const streamTeam = {
            id: 'team-stream',
            name: 'Stream Wolves',
            sport: 'Basketball',
            isPublic: false,
            teamPermissions: {
                streaming: {
                    mode: 'selected',
                    memberIds: ['user-1']
                }
            }
        };
        const visibleTeams = new Map([
            ['team-stream', streamTeam]
        ]);
        firebaseMocks.getDocs.mockResolvedValue({
            docs: [
                firestorePlayer('teams/team-stream/players/player-1', { name: 'Pat Stream', number: '7' })
            ]
        });

        const players = await searchAppPlayers('pat', visibleTeams, auth.user);
        expect(players).toEqual([{
            id: 'player:team-stream:player-1',
            kind: 'player',
            title: '#7 Pat Stream',
            subtitle: 'Stream Wolves',
            route: '/players/team-stream/player-1',
            teamId: 'team-stream',
            playerId: 'player-1'
        }]);

        const unrelatedUser = { ...auth.user, uid: 'unrelated-user', email: 'unrelated@example.com', parentOf: [] };
        const unrelatedPlayers = await searchAppPlayers('pat', visibleTeams, unrelatedUser);
        expect(unrelatedPlayers).toEqual([]);
    });

    it('searches player jersey numbers and encodes player routes', async () => {
        const visibleTeams = new Map([
            ['team odd', { id: 'team odd', name: 'Odd Bears', sport: 'Basketball', fromAppAccess: true }]
        ]);
        firebaseMocks.getDocs.mockImplementation(async (request) => {
            const nameLowerBound = request.parts.find((part) => part?.type === 'where' && part.field === 'name' && part.op === '>=')?.value;
            const numberLowerBound = request.parts.find((part) => part?.type === 'where' && part.field === 'number' && part.op === '>=')?.value;

            if (nameLowerBound === 'pa' || nameLowerBound === 'Pa') {
                return {
                    docs: [
                        firestorePlayer('teams/team odd/players/player one', { name: 'Pat Eleven', number: '11' })
                    ]
                };
            }

            if (numberLowerBound === '12') {
                return {
                    docs: [
                        firestorePlayer('teams/team odd/players/player one', { name: 'Jordan Twelve', number: '12' })
                    ]
                };
            }

            return { docs: [] };
        });

        await searchAppPlayers('pa', visibleTeams, auth.user);
        const callCountAfterNameSearch = firebaseMocks.getDocs.mock.calls.length;

        const players = await searchAppPlayers('12', visibleTeams, auth.user);

        expect(firebaseMocks.getDocs.mock.calls.length).toBeGreaterThan(callCountAfterNameSearch);
        const numberQueryCall = firebaseMocks.where.mock.calls.find(([field, op, value]) => field === 'number' && op === '>=' && value === '12');
        expect(numberQueryCall).toBeTruthy();
        expect(players).toEqual([{
            id: 'player:team odd:player one',
            kind: 'player',
            title: '#12 Jordan Twelve',
            subtitle: 'Odd Bears',
            route: '/players/team%20odd/player%20one',
            teamId: 'team odd',
            playerId: 'player one'
        }]);
    });

    it('uses team-scoped player queries for single-team and multi-token searches without collection-group fallback', async () => {
        const visibleTeams = new Map([
            ['team-1', { id: 'team-1', name: 'Bears', sport: 'Basketball', fromAppAccess: true }]
        ]);
        firebaseMocks.getDocs.mockImplementation(async (request) => {
            const ref = request.parts?.[0] || request || {};
            const collectionName = ref.collectionName || '';
            const nameLowerBound = request.parts?.find((part) => part?.type === 'where' && part.field === 'name' && part.op === '>=')?.value;
            if (collectionName.endsWith('/players') && (nameLowerBound === 'pat' || nameLowerBound === 'Pat')) {
                return {
                    docs: [firestorePlayer('teams/team-1/players/player-1', { name: 'Pat Bear', number: '4' })]
                };
            }
            if (collectionName.endsWith('/players') && (nameLowerBound === 'st' || nameLowerBound === 'St')) {
                return {
                    docs: [firestorePlayer('teams/team-1/players/player-1', { name: 'Pat Star', number: '4' })]
                };
            }
            return { docs: [] };
        });

        await expect(searchAppPlayers('pat', visibleTeams, auth.user)).resolves.toEqual([{
            id: 'player:team-1:player-1',
            kind: 'player',
            title: '#4 Pat Bear',
            subtitle: 'Bears',
            route: '/players/team-1/player-1',
            teamId: 'team-1',
            playerId: 'player-1'
        }]);

        await expect(searchAppPlayers('pat st', visibleTeams, auth.user)).resolves.toEqual([
            {
                id: 'player:team-1:player-1',
                kind: 'player',
                title: '#4 Pat Star',
                subtitle: 'Bears',
                route: '/players/team-1/player-1',
                teamId: 'team-1',
                playerId: 'player-1'
            }
        ]);
        expect(firebaseMocks.collectionGroup).not.toHaveBeenCalled();
    });

    it('surfaces Firestore player search errors when every scoped player query fails', async () => {
        const visibleTeams = new Map([
            ['team-1', { id: 'team-1', name: 'Bears', sport: 'Basketball', fromAppAccess: true }]
        ]);
        const error = Object.assign(new Error('permission denied'), { code: 'permission-denied' });
        firebaseMocks.getDocs.mockRejectedValue(error);

        await expect(searchAppPlayers('pat', visibleTeams, auth.user)).rejects.toThrow('permission denied');
    });
});
