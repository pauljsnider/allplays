import { describe, expect, it } from 'vitest';
import {
    hasAdminGlobalSearchTerm,
    normalizeAdminSearchTerm,
    selectAdminItemById,
    selectAdminSearchCollection
} from '../../js/admin-search.js';

describe('admin search collection selection', () => {
    it('keeps empty searches scoped to the current paginated page', () => {
        const pageItems = [{ id: 'team-1', name: 'Aardvarks' }];
        const globalItems = [{ id: 'team-99', name: 'Zebras' }];

        expect(selectAdminSearchCollection({ searchTerm: '', pageItems, globalItems })).toBe(pageItems);
        expect(selectAdminSearchCollection({ searchTerm: '   ', pageItems, globalItems })).toBe(pageItems);
    });

    it('uses the collection-wide cache when admins enter a search term', () => {
        const pageItems = [{ id: 'user-1', email: 'alpha@example.com' }];
        const globalItems = [{ id: 'user-99', email: 'zeta@example.com' }];

        expect(selectAdminSearchCollection({ searchTerm: 'zeta', pageItems, globalItems })).toBe(globalItems);
    });

    it('normalizes whitespace and casing before deciding whether search is global', () => {
        expect(normalizeAdminSearchTerm('  Team Z  ')).toBe('team z');
        expect(hasAdminGlobalSearchTerm('  Team Z  ')).toBe(true);
        expect(hasAdminGlobalSearchTerm('\n\t')).toBe(false);
    });

    it('resolves row actions against global search results outside the current page', () => {
        const pageItems = [{ id: 'team-1', name: 'Current page' }];
        const globalItems = [{ id: 'team-99', name: 'Search result' }];
        const fallbackItems = [{ id: 'team-100', name: 'Dashboard cached' }];

        expect(selectAdminItemById({ id: 'team-99', pageItems, globalItems, fallbackItems })).toBe(globalItems[0]);
        expect(selectAdminItemById({ id: 'team-100', pageItems, globalItems, fallbackItems })).toBe(fallbackItems[0]);
        expect(selectAdminItemById({ id: 'missing', pageItems, globalItems, fallbackItems })).toBeNull();
    });

    it('documents that non-empty user searches use the global lookup source', () => {
        const pageUsers = [{ id: 'user-1', email: 'page@example.com' }];
        const globalUsers = [{ id: 'user-99', email: 'official@example.com' }];

        expect(selectAdminSearchCollection({
            searchTerm: 'official',
            pageItems: pageUsers,
            globalItems: globalUsers
        })).toBe(globalUsers);
    });
});
