// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { playerSearchFirestoreQueryBudget } from '../../js/player-search-budget.js';

const dbMocks = vi.hoisted(() => ({
    discoverPublicTeams: vi.fn()
}));

const firebaseMocks = vi.hoisted(() => ({
    db: {},
    collection: vi.fn((db, path) => ({ db, path })),
    getDocs: vi.fn(async () => ({ docs: [] })),
    getDoc: vi.fn(),
    doc: vi.fn((db, ...segments) => ({ db, path: segments.join('/') })),
    query: vi.fn((...parts) => ({ parts })),
    where: vi.fn((field, op, value) => ({ type: 'where', field, op, value })),
    orderBy: vi.fn((field) => ({ type: 'orderBy', field })),
    limit: vi.fn((count) => ({ type: 'limit', count }))
}));

vi.mock('../../js/db.js?v=4433199', () => dbMocks);
vi.mock('../../js/firebase.js?v=33', () => firebaseMocks);
vi.mock('../../js/utils.js?v=443376', () => ({
    escapeHtml: (value) => String(value || '')
}));
vi.mock('../../js/global-search-visibility.js?v=44335', () => ({
    filterSearchableTeams: (teams) => Array.isArray(teams) ? teams : [],
    canUserDiscoverPlayerInSearch: () => true
}));
vi.mock('../../js/team-visibility.js?v=2', () => ({
    isTeamActive: (team) => team?.active !== false && team?.archived !== true && String(team?.status || '').toLowerCase() !== 'archived'
}));

function firestoreDoc(id, data, exists = true) {
    return {
        id,
        exists: () => exists,
        data: () => data
    };
}

function firestorePlayer(path, data) {
    return {
        id: path.split('/').pop(),
        ref: { path },
        data: () => data
    };
}

async function flushAsyncWork() {
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();
}

function searchableParent(teamId = 'team-access', teamName = 'Access Rockets') {
    return {
        teamId,
        teamName,
        sport: 'Basketball',
        isPublic: false,
        active: true,
        status: 'active'
    };
}

function openGlobalSearch() {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
}

async function searchFor(value) {
    const input = document.querySelector('[data-global-search-input="1"]');
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(200);
    await flushAsyncWork();
}

function closeGlobalSearch() {
    document.querySelector('[data-global-search-close="1"]')?.click();
}

function playerGetDocsCalls() {
    return firebaseMocks.getDocs.mock.calls.filter(([request]) => {
        const ref = request?.parts?.[0] || request || {};
        return /^teams\/[^/]+\/players$/.test(ref.path || '');
    });
}

describe('legacy global search modal', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();
        vi.clearAllMocks();
        document.body.innerHTML = '';
        firebaseMocks.getDocs.mockResolvedValue({ docs: [] });
        firebaseMocks.getDoc.mockResolvedValue(firestoreDoc('team-access', {
            name: 'Access Rockets',
            sport: 'Basketball',
            isPublic: false,
            active: true
        }));
        dbMocks.discoverPublicTeams.mockResolvedValue({
            teams: [{ id: 'team-public', name: 'Bearcats', sport: 'Soccer', isPublic: true, active: true }],
            nextCursor: null
        });
    });

    it('opens without bootstrapping all public teams and waits for a 2-character query before public discovery', async () => {
        const { setupHeaderSearch } = await import('../../js/global-search.js?v=443357');

        setupHeaderSearch({
            user: {
                uid: 'parent-1',
                email: 'parent@example.com',
                parentOf: [{ teamId: 'team-access', playerId: 'player-1' }]
            },
            headerContainer: null
        });

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
        await flushAsyncWork();
        await flushAsyncWork();

        expect(dbMocks.discoverPublicTeams).not.toHaveBeenCalled();
        expect(document.body.textContent).toContain('Access Rockets');
        expect(document.body.textContent).not.toContain('Bearcats');

        const input = document.querySelector('[data-global-search-input="1"]');
        input.value = 'b';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        vi.advanceTimersByTime(200);
        await flushAsyncWork();

        expect(dbMocks.discoverPublicTeams).not.toHaveBeenCalled();

        input.value = 'be';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        vi.advanceTimersByTime(200);
        await flushAsyncWork();

        expect(dbMocks.discoverPublicTeams).toHaveBeenCalledWith({ searchText: 'be', pageSize: 20 });
        expect(document.body.textContent).toContain('Bearcats');
        expect(firebaseMocks.doc).toHaveBeenCalledWith(firebaseMocks.db, 'teams', 'team-access');
    });

    it('uses parent team link visibility summaries without per-team fallback reads', async () => {
        const { setupHeaderSearch } = await import('../../js/global-search.js?v=443357');

        setupHeaderSearch({
            user: {
                uid: 'parent-1',
                email: 'parent@example.com',
                parentOf: [
                    {
                        teamId: 'team-summary',
                        teamName: 'Summary Rockets',
                        sport: 'Basketball',
                        isPublic: false,
                        active: true,
                        status: 'active'
                    },
                    {
                        teamId: 'team-private-visibility',
                        teamName: 'Visibility Rockets',
                        sport: 'Soccer',
                        visibility: 'private',
                        active: true,
                        status: 'active'
                    },
                    {
                        teamId: 'team-archived',
                        teamName: 'Archived Rockets',
                        sport: 'Soccer',
                        isPublic: false,
                        status: 'archived'
                    }
                ]
            },
            headerContainer: null
        });

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
        await flushAsyncWork();
        await flushAsyncWork();

        expect(firebaseMocks.getDoc).not.toHaveBeenCalled();
        expect(document.body.textContent).toContain('Summary Rockets');
        expect(document.body.textContent).toContain('Visibility Rockets');
        expect(document.body.textContent).not.toContain('Archived Rockets');
    });

    it('falls back to Firestore when parent links only mark app access without visibility', async () => {
        const { setupHeaderSearch } = await import('../../js/global-search.js?v=443357');

        firebaseMocks.getDoc.mockResolvedValueOnce(firestoreDoc('team-app-access-only', {
            name: 'Stored Access Rockets',
            sport: 'Basketball',
            isPublic: false,
            active: true
        }));

        setupHeaderSearch({
            user: {
                uid: 'parent-1',
                email: 'parent@example.com',
                parentOf: [
                    {
                        teamId: 'team-app-access-only',
                        teamName: 'Access Rockets',
                        sport: 'Basketball',
                        appAccess: true,
                        active: true
                    }
                ]
            },
            headerContainer: null
        });

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
        await flushAsyncWork();
        await flushAsyncWork();

        expect(firebaseMocks.doc).toHaveBeenCalledWith(firebaseMocks.db, 'teams', 'team-app-access-only');
        expect(document.body.textContent).toContain('Stored Access Rockets');
    });

    it('searches a query-matching private team beyond the first eight private teams', async () => {
        const { setupHeaderSearch } = await import('../../js/global-search.js?v=443357');
        const privateTeams = [
            ...Array.from({ length: 8 }, (_, index) => ({
                teamId: `team-private-${index}`,
                teamName: `Alpha Private ${index}`,
                sport: 'Basketball',
                isPublic: false,
                active: true,
                status: 'active'
            })),
            {
                teamId: 'team-match',
                teamName: 'Patriots',
                sport: 'Basketball',
                isPublic: false,
                active: true,
                status: 'active'
            }
        ];
        const queriedTeamIds = new Set();
        let playerQueryCount = 0;

        firebaseMocks.getDocs.mockImplementation(async (request) => {
            const ref = request.parts?.[0] || request || {};
            const path = ref.path || '';
            const match = path.match(/^teams\/([^/]+)\/players$/);
            if (match) {
                playerQueryCount += 1;
                queriedTeamIds.add(match[1]);
                if (match[1] === 'team-match') {
                    return {
                        docs: [firestorePlayer('teams/team-match/players/player-1', { name: 'Pat Forward', number: '3' })]
                    };
                }
            }
            return { docs: [] };
        });

        setupHeaderSearch({
            user: {
                uid: 'parent-1',
                email: 'parent@example.com',
                parentOf: privateTeams
            },
            headerContainer: null
        });

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
        await flushAsyncWork();
        await flushAsyncWork();

        const input = document.querySelector('[data-global-search-input="1"]');
        input.value = 'pat';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await vi.advanceTimersByTimeAsync(200);
        await flushAsyncWork();

        expect(queriedTeamIds.has('team-match')).toBe(true);
        expect(queriedTeamIds.has('team-private-7')).toBe(false);
        expect(playerQueryCount).toBe(playerSearchFirestoreQueryBudget);
        expect(document.body.textContent).toContain('#3 Pat Forward');
        expect(document.body.textContent).toContain('Patriots');
    });

    it('reuses completed normalized searches after clearing and reopening the modal', async () => {
        const { setupHeaderSearch } = await import('../../js/global-search.js?v=443357');

        firebaseMocks.getDocs.mockResolvedValue({ docs: [] });
        setupHeaderSearch({
            user: { parentOf: [searchableParent()] },
            headerContainer: null
        });

        openGlobalSearch();
        await flushAsyncWork();
        await searchFor('  BE  ');

        expect(dbMocks.discoverPublicTeams).toHaveBeenCalledTimes(1);
        expect(playerGetDocsCalls()).toHaveLength(2);

        await searchFor('');
        await searchFor('be');
        closeGlobalSearch();
        openGlobalSearch();
        await flushAsyncWork();
        await searchFor('Be');

        expect(dbMocks.discoverPublicTeams).toHaveBeenCalledTimes(1);
        expect(playerGetDocsCalls()).toHaveLength(2);
        expect(document.body.textContent).toContain('Bearcats');

        await searchFor('12');
        expect(dbMocks.discoverPublicTeams).toHaveBeenCalledTimes(2);
        expect(playerGetDocsCalls()).toHaveLength(4);

        await searchFor('be');
        expect(dbMocks.discoverPublicTeams).toHaveBeenCalledTimes(2);
        expect(playerGetDocsCalls()).toHaveLength(4);
    });

    it('coalesces identical team and player searches while their requests are in flight', async () => {
        const { setupHeaderSearch } = await import('../../js/global-search.js?v=443357');
        let resolveTeamSearch;
        const playerResolvers = [];

        dbMocks.discoverPublicTeams.mockImplementation(() => new Promise((resolve) => {
            resolveTeamSearch = resolve;
        }));
        firebaseMocks.getDocs.mockImplementation((request) => {
            const ref = request?.parts?.[0] || request || {};
            if (/^teams\/[^/]+\/players$/.test(ref.path || '')) {
                return new Promise((resolve) => playerResolvers.push(resolve));
            }
            return Promise.resolve({ docs: [] });
        });
        setupHeaderSearch({ user: { parentOf: [searchableParent()] }, headerContainer: null });

        openGlobalSearch();
        await flushAsyncWork();
        await searchFor('pat');
        expect(dbMocks.discoverPublicTeams).toHaveBeenCalledTimes(1);
        expect(playerGetDocsCalls()).toHaveLength(1);

        await searchFor('');
        await searchFor('PAT');
        expect(dbMocks.discoverPublicTeams).toHaveBeenCalledTimes(1);
        expect(playerGetDocsCalls()).toHaveLength(1);

        resolveTeamSearch({ teams: [], nextCursor: null });
        playerResolvers.shift()({ docs: [] });
        await flushAsyncWork();
        expect(playerGetDocsCalls()).toHaveLength(2);
        playerResolvers.shift()({ docs: [] });
        await flushAsyncWork();
    });

    it('removes failed searches from the cache so the same query can retry', async () => {
        const { setupHeaderSearch } = await import('../../js/global-search.js?v=443357');
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        dbMocks.discoverPublicTeams
            .mockRejectedValueOnce(new Error('temporary team failure'))
            .mockResolvedValue({ teams: [], nextCursor: null });
        firebaseMocks.getDocs
            .mockRejectedValueOnce(new Error('temporary player failure'))
            .mockRejectedValueOnce(new Error('temporary player failure'))
            .mockResolvedValue({ docs: [] });
        setupHeaderSearch({ user: { parentOf: [searchableParent()] }, headerContainer: null });

        openGlobalSearch();
        await flushAsyncWork();
        await searchFor('retry');
        await searchFor('');
        await searchFor('RETRY');

        expect(dbMocks.discoverPublicTeams).toHaveBeenCalledTimes(2);
        expect(playerGetDocsCalls()).toHaveLength(4);
        expect(document.body.textContent).not.toContain('Public team search unavailable.');
        expect(document.body.textContent).not.toContain('Player search unavailable.');
        consoleError.mockRestore();
    });

    it('bounds completed caches and isolates results when the user or accessible teams change', async () => {
        const { setupHeaderSearch } = await import('../../js/global-search.js?v=443357');
        const queries = Array.from({ length: 21 }, (_, index) => `q${String.fromCharCode(97 + index)}`);

        firebaseMocks.getDocs.mockResolvedValue({ docs: [] });
        setupHeaderSearch({
            user: { uid: 'user-1', parentOf: [searchableParent('team-one', 'Team One')] },
            headerContainer: null
        });
        openGlobalSearch();
        await flushAsyncWork();
        for (const queryText of queries) {
            await searchFor(queryText);
        }
        const completedPlayerCalls = playerGetDocsCalls().length;
        await searchFor(queries[0]);

        expect(dbMocks.discoverPublicTeams).toHaveBeenCalledTimes(22);
        expect(playerGetDocsCalls().length).toBeGreaterThan(completedPlayerCalls);

        closeGlobalSearch();
        setupHeaderSearch({
            user: { uid: 'user-1', parentOf: [searchableParent('team-two', 'Team Two')] },
            headerContainer: null
        });
        openGlobalSearch();
        await flushAsyncWork();
        await searchFor(queries[1]);

        expect(dbMocks.discoverPublicTeams).toHaveBeenCalledTimes(23);
        expect(playerGetDocsCalls().at(-1)?.[0]?.parts?.[0]?.path).toBe('teams/team-two/players');

        closeGlobalSearch();
        setupHeaderSearch({
            user: { uid: 'user-2', parentOf: [searchableParent('team-two', 'Team Two')] },
            headerContainer: null
        });
        openGlobalSearch();
        await flushAsyncWork();
        await searchFor(queries[1]);

        expect(dbMocks.discoverPublicTeams).toHaveBeenCalledTimes(24);
        expect(playerGetDocsCalls().at(-1)?.[0]?.parts?.[0]?.path).toBe('teams/team-two/players');
    });
});
