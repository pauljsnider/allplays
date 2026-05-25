import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
    getTeams: vi.fn()
}));

const homeMocks = vi.hoisted(() => ({
    loadParentHome: vi.fn()
}));

const firebaseMocks = vi.hoisted(() => ({
    db: {},
    collectionGroup: vi.fn((db, collectionName) => ({ db, collectionName })),
    getDocs: vi.fn(),
    query: vi.fn((...parts) => ({ parts })),
    where: vi.fn((field, op, value) => ({ type: 'where', field, op, value })),
    orderBy: vi.fn((field) => ({ type: 'orderBy', field })),
    limit: vi.fn((count) => ({ type: 'limit', count }))
}));

vi.mock('../../js/db.js', () => dbMocks);
vi.mock('../../js/firebase.js', () => firebaseMocks);
vi.mock('../../apps/app/src/lib/homeService.ts', () => homeMocks);

import {
    buildAppSearchActions,
    computeAppSearchResults,
    loadAppSearchTeams,
    resetAppSearchCacheForTests,
    scoreSearchText,
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

beforeEach(() => {
    vi.clearAllMocks();
    resetAppSearchCacheForTests();
});

describe('React app search service', () => {
    it('builds current-site style actions for signed out, signed in, and admin users', () => {
        expect(buildAppSearchActions({ user: null, isAdmin: false, isPlatformAdmin: false }).map((item) => item.id)).toEqual([
            'browse-teams',
            'sign-in',
            'get-started'
        ]);

        expect(buildAppSearchActions(auth).map((item) => item.id)).toEqual([
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

    it('loads public/current-site teams and merges private teams from app access', async () => {
        dbMocks.getTeams.mockResolvedValue([
            { id: 'team-public', name: 'Public Bears', sport: 'Soccer', isPublic: true },
            { id: 'team-inactive', name: 'Inactive Sharks', sport: 'Soccer', isPublic: true, active: false },
            { id: 'team-private', name: 'Private Wolves', sport: 'Basketball', isPublic: false },
            { id: 'team-admin', name: 'Admin Lions', sport: 'Soccer', isPublic: false, adminEmails: ['parent@example.com'] },
            { id: 'team-owner', name: 'Owner Eagles', sport: 'Volleyball', isPublic: false, ownerId: 'user-1' },
            { id: 'team-home', name: 'Parent Falcons', sport: 'Softball', isPublic: false }
        ]);
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
            }]
        });

        const teams = await loadAppSearchTeams(auth.user);

        expect(teams.map((team) => team.id)).toEqual(['team-admin', 'team-home', 'team-owner', 'team-public']);
        expect(teams.find((team) => team.id === 'team-home')).toMatchObject({
            name: 'Home Rockets',
            fromAppAccess: true,
            photoUrl: 'https://img.example.test/home.png'
        });
        expect(teams.find((team) => team.id === 'team-private')).toBeUndefined();
        expect(teams.find((team) => team.id === 'team-inactive')).toBeUndefined();
        expect(teams.find((team) => team.id === 'team-inactive-access')).toBeUndefined();
    });

    it('caches loaded teams and falls back to app access when public team loading fails', async () => {
        dbMocks.getTeams.mockResolvedValue([
            { id: 'team-1', name: 'Bears', sport: 'Soccer', isPublic: true }
        ]);
        homeMocks.loadParentHome.mockResolvedValue({
            teams: [{ teamId: 'team-home', teamName: 'Home Rockets', sport: 'Basketball' }]
        });

        const first = await loadAppSearchTeams(auth.user);
        const second = await loadAppSearchTeams(auth.user);

        expect(second).toBe(first);
        expect(dbMocks.getTeams).toHaveBeenCalledTimes(1);
        expect(homeMocks.loadParentHome).toHaveBeenCalledTimes(1);
        expect(first.map((team) => team.id)).toEqual(['team-1', 'team-home']);

        resetAppSearchCacheForTests();
        dbMocks.getTeams.mockRejectedValueOnce(new Error('public teams down'));
        homeMocks.loadParentHome.mockResolvedValueOnce({
            teams: [{ teamId: 'team-private-access', teamName: 'Private Access', sport: 'Soccer' }]
        });

        await expect(loadAppSearchTeams(auth.user)).resolves.toMatchObject([
            { id: 'team-private-access', name: 'Private Access', fromAppAccess: true }
        ]);
    });

    it('throws the first team loading error when no searchable team source succeeds', async () => {
        dbMocks.getTeams.mockRejectedValueOnce(new Error('public teams down'));
        homeMocks.loadParentHome.mockRejectedValueOnce(new Error('home down'));

        await expect(loadAppSearchTeams(auth.user)).rejects.toThrow('public teams down');
    });

    it('searches players by Firestore collection group and filters by visible teams', async () => {
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

        expect(firebaseMocks.collectionGroup).toHaveBeenCalledWith(firebaseMocks.db, 'players');
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

    it('searches player jersey numbers and encodes player routes', async () => {
        const visibleTeams = new Map([
            ['team odd', { id: 'team odd', name: 'Odd Bears', sport: 'Basketball', fromAppAccess: true }]
        ]);
        firebaseMocks.getDocs.mockResolvedValue({
            docs: [
                firestorePlayer('teams/team odd/players/player one', { name: 'Jordan Twelve', number: '12' })
            ]
        });

        const players = await searchAppPlayers('12', visibleTeams, auth.user);

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

    it('surfaces Firestore player search errors when every player query fails', async () => {
        const visibleTeams = new Map([
            ['team-1', { id: 'team-1', name: 'Bears', sport: 'Basketball', fromAppAccess: true }]
        ]);
        const error = Object.assign(new Error('permission denied'), { code: 'permission-denied' });
        firebaseMocks.getDocs.mockRejectedValue(error);

        await expect(searchAppPlayers('pat', visibleTeams, auth.user)).rejects.toThrow('permission denied');
    });
});
