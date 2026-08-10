import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
    collection: vi.fn((database, name) => ({ type: 'collection', name })),
    getDocs: vi.fn(),
    limit: vi.fn((value) => ({ type: 'limit', value })),
    orderBy: vi.fn((field) => ({ type: 'orderBy', field })),
    query: vi.fn((...parts) => ({ parts })),
    where: vi.fn((field, op, value) => ({ type: 'where', field, op, value }))
}));

vi.mock('../../js/firebase.js?v=23', () => ({
    db: {},
    collection: firebaseMocks.collection,
    getDocs: firebaseMocks.getDocs,
    limit: firebaseMocks.limit,
    orderBy: firebaseMocks.orderBy,
    query: firebaseMocks.query,
    where: firebaseMocks.where
}));

import {
    ADMIN_TEAM_SEARCH_QUERY_CEILING,
    ADMIN_TEAM_SEARCH_RESULT_LIMIT,
    buildAdminTeamSearchStrategies,
    createDebouncedAdminTeamSearch,
    mergeAdminTeamSearchResults,
    resolveAdminTeamSearchResult,
    searchAdminTeams,
    shouldRunRemoteAdminTeamSearch
} from '../../js/admin-team-search.js';

function firestoreDoc(id, data) {
    return { id, data: () => data };
}

function findConstraint(request, type, field) {
    return request.parts.find((part) => part?.type === type && (!field || part.field === field));
}

describe('bounded admin team search', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firebaseMocks.getDocs.mockResolvedValue({ docs: [] });
    });

    it('uses a documented constant query ceiling and capped candidate queries', async () => {
        const strategies = buildAdminTeamSearchStrategies('  zeta  ');

        expect(strategies).toHaveLength(ADMIN_TEAM_SEARCH_QUERY_CEILING);
        expect(strategies).toContainEqual({ field: 'publicSearchName', prefix: 'zeta' });
        expect(strategies).toContainEqual({ field: 'sport', prefix: 'Zeta' });

        await searchAdminTeams('zeta');

        expect(firebaseMocks.getDocs).toHaveBeenCalledTimes(ADMIN_TEAM_SEARCH_QUERY_CEILING);
        firebaseMocks.getDocs.mock.calls.forEach(([request]) => {
            expect(findConstraint(request, 'limit')?.value).toBe(ADMIN_TEAM_SEARCH_RESULT_LIMIT);
            expect(findConstraint(request, 'startAfter')).toBeUndefined();
        });
    });

    it.each([
        ['name', 'zeta', { name: 'Zeta United', sport: 'Soccer', publicSearchName: 'zeta united' }],
        ['sport', 'volleyball', { name: 'Later Team', sport: 'Volleyball', publicSearchName: 'later team' }]
    ])('finds a later-page team by %s without draining pagination', async (_field, term, teamData) => {
        const laterTeam = firestoreDoc('team-150', teamData);
        firebaseMocks.getDocs.mockImplementation(async (request) => {
            const lowerBound = request.parts.find((part) => part?.type === 'where' && part.op === '>=');
            if (
                (lowerBound.field === 'publicSearchName' && lowerBound.value === term)
                || (lowerBound.field === 'sport' && lowerBound.value === 'Volleyball')
            ) return { docs: [laterTeam] };
            return { docs: [] };
        });

        const teams = await searchAdminTeams(term);

        expect(teams).toEqual([{ id: 'team-150', ...teamData }]);
        expect(firebaseMocks.getDocs.mock.calls.length).toBeLessThanOrEqual(ADMIN_TEAM_SEARCH_QUERY_CEILING);
        expect(firebaseMocks.query.mock.calls.flat()).not.toContainEqual(expect.objectContaining({ type: 'startAfter' }));
    });

    it('deduplicates current-page and remote matches and caps merged results', () => {
        const pageTeam = { id: 'team-1', name: 'Zeta Current', sport: 'Soccer' };
        const remoteTeams = [
            pageTeam,
            ...Array.from({ length: 75 }, (_, index) => ({
                id: `team-${index + 2}`,
                name: `Zeta ${index + 2}`,
                sport: 'Soccer'
            }))
        ];

        const teams = mergeAdminTeamSearchResults([pageTeam], remoteTeams, 'zeta');

        expect(teams).toHaveLength(ADMIN_TEAM_SEARCH_RESULT_LIMIT);
        expect(teams.filter((team) => team.id === 'team-1')).toHaveLength(1);
    });

    it('requires two normalized characters, debounces typing, and suppresses stale responses', async () => {
        vi.useFakeTimers();
        let resolveSearch;
        const search = vi.fn(() => new Promise((resolve) => {
            resolveSearch = resolve;
        }));
        const runSearch = createDebouncedAdminTeamSearch({ search, debounceMs: 300 });

        expect(shouldRunRemoteAdminTeamSearch(' z ')).toBe(false);
        await expect(runSearch('z')).resolves.toMatchObject({ remote: false, teams: [] });

        const canceled = runSearch('ze');
        const pending = runSearch('zeta');
        await expect(canceled).resolves.toMatchObject({ stale: true, remote: false });
        await vi.advanceTimersByTimeAsync(300);
        expect(search).toHaveBeenCalledTimes(1);
        expect(search).toHaveBeenCalledWith('zeta');

        await expect(runSearch('')).resolves.toMatchObject({ remote: false, teams: [] });
        resolveSearch([{ id: 'team-150', name: 'Zeta United' }]);
        await expect(pending).resolves.toMatchObject({ stale: true, remote: true });
        vi.useRealTimers();
    });

    it('clearing a search restores the current page and preserves remote rows for actions', () => {
        const pageTeams = [{ id: 'team-1', name: 'Current Team' }];
        const remoteTeam = { id: 'team-150', name: 'Zeta United' };

        expect(resolveAdminTeamSearchResult(pageTeams, {
            term: '',
            teams: [],
            stale: false,
            remote: false
        })).toBe(pageTeams);
        expect(resolveAdminTeamSearchResult(pageTeams, {
            term: 'zeta',
            teams: [remoteTeam],
            stale: false,
            remote: true
        })).toEqual([remoteTeam]);
    });
});
