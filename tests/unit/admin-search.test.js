import { describe, expect, it, vi } from 'vitest';
import {
    ADMIN_USER_SEARCH_CANDIDATE_QUERY_CEILING,
    ADMIN_USER_SEARCH_MAX_LENGTH,
    ADMIN_USER_SEARCH_RESULT_LIMIT,
    ADMIN_USER_SEARCH_TOTAL_QUERY_CEILING,
    buildAdminUserSearchHash,
    buildAdminUserSearchStrategies,
    createDebouncedAdminUserSearch,
    hasAdminGlobalSearchTerm,
    loadCompleteAdminSearchCollection,
    mergeAdminUserSearchResults,
    mergeBoundedAdminUserCandidates,
    normalizeAdminSearchTerm,
    resolveAdminUserSearchResult,
    selectAdminItemById,
    selectAdminSearchCollection,
    shouldRunRemoteAdminUserSearch
} from '../../js/admin-search.js';

describe('admin search collection selection', () => {
    it('keeps empty searches scoped to the current paginated page', () => {
        const pageItems = [{ id: 'team-1', name: 'Aardvarks' }];
        const globalItems = [{ id: 'team-99', name: 'Zebras' }];

        expect(selectAdminSearchCollection({ searchTerm: '', pageItems, globalItems })).toBe(pageItems);
        expect(selectAdminSearchCollection({ searchTerm: '   ', pageItems, globalItems })).toBe(pageItems);
    });

    it('keeps the legacy collection-wide cache available for team search', () => {
        const pageItems = [{ id: 'team-1', name: 'Alpha' }];
        const globalItems = [{ id: 'team-99', name: 'Zeta' }];

        expect(selectAdminSearchCollection({ searchTerm: 'zeta', pageItems, globalItems })).toBe(globalItems);
    });

    it('loads every admin page only for the unchanged team search path', async () => {
        const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: `team-${index + 1}` }));
        const secondPage = Array.from({ length: 50 }, (_, index) => ({ id: `team-${index + 101}` }));
        const firstCursor = { id: 'team-100' };
        const fetchPage = vi.fn()
            .mockResolvedValueOnce({ teams: firstPage, nextCursor: firstCursor })
            .mockResolvedValueOnce({ teams: secondPage, nextCursor: null });

        const teams = await loadCompleteAdminSearchCollection({ fetchPage, itemsKey: 'teams' });

        expect(fetchPage).toHaveBeenNthCalledWith(1, { pageSize: 100 });
        expect(fetchPage).toHaveBeenNthCalledWith(2, { pageSize: 100, cursor: firstCursor });
        expect(teams).toHaveLength(150);
        expect(teams.at(-1)).toEqual({ id: 'team-150' });
    });

    it('normalizes whitespace and casing before deciding whether search is global', () => {
        expect(normalizeAdminSearchTerm('  Team Z  ')).toBe('team z');
        expect(hasAdminGlobalSearchTerm('  Team Z  ')).toBe(true);
        expect(hasAdminGlobalSearchTerm('\n\t')).toBe(false);
        expect(normalizeAdminSearchTerm('X'.repeat(ADMIN_USER_SEARCH_MAX_LENGTH + 20)))
            .toBe('x'.repeat(ADMIN_USER_SEARCH_MAX_LENGTH));
    });

    it('resolves row actions against global search results outside the current page', () => {
        const pageItems = [{ id: 'team-1', name: 'Current page' }];
        const globalItems = [{ id: 'team-99', name: 'Search result' }];
        const fallbackItems = [{ id: 'team-100', name: 'Dashboard cached' }];

        expect(selectAdminItemById({ id: 'team-99', pageItems, globalItems, fallbackItems })).toBe(globalItems[0]);
        expect(selectAdminItemById({ id: 'team-100', pageItems, globalItems, fallbackItems })).toBe(fallbackItems[0]);
        expect(selectAdminItemById({ id: 'missing', pageItems, globalItems, fallbackItems })).toBeNull();
    });

    it('builds a constant number of bounded user, official, and team candidate queries', () => {
        const strategies = buildAdminUserSearchStrategies('  robin  ');

        expect(strategies).toEqual({
            users: [
                { field: 'email', prefix: 'robin' },
                { field: 'fullName', prefix: 'Robin' },
                { field: 'phone', prefix: 'robin' }
            ],
            indexHash: buildAdminUserSearchHash('robin'),
            officials: [
                { field: 'email', prefix: 'robin' },
                { field: 'name', prefix: 'Robin' },
                { field: 'phone', prefix: 'robin' }
            ],
            teams: [{ field: 'name', prefix: 'Robin' }]
        });
        expect(ADMIN_USER_SEARCH_CANDIDATE_QUERY_CEILING).toBe(17);
        expect(ADMIN_USER_SEARCH_TOTAL_QUERY_CEILING).toBe(21);
    });

    it('finds and caps a later server candidate without scanning paginated users', () => {
        const firstHundred = Array.from({ length: 100 }, (_, index) => ({
            id: `user-${index + 1}`,
            email: `user${index + 1}@example.com`
        }));
        const laterMatch = { id: 'user-450', email: 'zeta@example.com' };
        const candidates = mergeBoundedAdminUserCandidates([
            [laterMatch],
            firstHundred
        ]);

        expect(candidates).toHaveLength(ADMIN_USER_SEARCH_RESULT_LIMIT);
        expect(candidates[0]).toEqual(laterMatch);
        expect(candidates.some((user) => user.id === 'user-450')).toBe(true);
    });

    it('keeps current-page substring matches alongside remote prefix candidates', () => {
        const pageUsers = [
            { id: 'user-1', fullName: 'Jane Smith' },
            { id: 'user-2', fullName: 'Alex Jones' }
        ];
        const remoteUsers = [{ id: 'user-99', fullName: 'Smithson, Robin' }];

        const candidates = mergeAdminUserSearchResults(pageUsers, remoteUsers, 'smith');

        expect(candidates).toEqual([pageUsers[0], remoteUsers[0]]);
        expect(candidates.filter((user) => user.fullName.toLowerCase().includes('smith')))
            .toEqual([pageUsers[0], remoteUsers[0]]);
    });

    it('merges a completed remote result using the normalized term carried by that result', () => {
        const pageUsers = [{ id: 'user-1', fullName: 'Jane Smith' }];
        const remoteUsers = [{ id: 'user-99', fullName: 'Smithson, Robin' }];

        expect(resolveAdminUserSearchResult(pageUsers, {
            term: 'smith',
            users: remoteUsers,
            stale: false,
            remote: true
        })).toEqual([pageUsers[0], remoteUsers[0]]);
        expect(resolveAdminUserSearchResult(pageUsers, {
            term: 'smith',
            users: remoteUsers,
            stale: true,
            remote: true
        })).toBeNull();
    });

    it('requires two normalized characters and debounces rapid typing', async () => {
        vi.useFakeTimers();
        const search = vi.fn().mockResolvedValue([{ id: 'user-450' }]);
        const runSearch = createDebouncedAdminUserSearch({ search, debounceMs: 300 });

        expect(shouldRunRemoteAdminUserSearch(' z ')).toBe(false);
        expect(shouldRunRemoteAdminUserSearch(' ZE ')).toBe(true);
        await expect(runSearch('z')).resolves.toMatchObject({ remote: false, users: [] });

        const first = runSearch('ze');
        const newest = runSearch('zeta');
        await expect(first).resolves.toMatchObject({ stale: true, remote: false });
        await vi.advanceTimersByTimeAsync(299);
        expect(search).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await expect(newest).resolves.toMatchObject({
            term: 'zeta',
            users: [{ id: 'user-450' }],
            stale: false,
            remote: true
        });
        expect(search).toHaveBeenCalledTimes(1);
        expect(search).toHaveBeenCalledWith('zeta');
        vi.useRealTimers();
    });

    it('suppresses an in-flight response after the term changes or clears', async () => {
        let resolveSearch;
        const search = vi.fn(() => new Promise((resolve) => {
            resolveSearch = resolve;
        }));
        const runSearch = createDebouncedAdminUserSearch({ search, debounceMs: 0 });

        const pending = runSearch('later');
        await new Promise((resolve) => setTimeout(resolve, 0));
        await expect(runSearch('')).resolves.toMatchObject({ remote: false, users: [] });
        resolveSearch([{ id: 'stale-user' }]);

        await expect(pending).resolves.toMatchObject({
            stale: true,
            remote: true
        });
    });
});
