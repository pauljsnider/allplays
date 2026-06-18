import { describe, expect, it, vi } from 'vitest';
import { executeBoundedPlayerSearch, playerSearchResultLimit } from '../../js/player-search-budget.js';

function docsForPrefix(prefix, count = playerSearchResultLimit) {
    return {
        docs: Array.from({ length: count }, (_, index) => ({
            id: `${prefix}-${index}`,
            ref: { path: `teams/team-1/players/${prefix}-${index}` }
        }))
    };
}

describe('executeBoundedPlayerSearch', () => {
    it('keeps querying later prefixes even after earlier prefixes fill the raw doc budget', async () => {
        const runNameQuery = vi.fn(async (_teamId, prefix) => {
            if (prefix === 'smith') return docsForPrefix(prefix);
            if (prefix === 'ali') return docsForPrefix(prefix, 1);
            return { docs: [] };
        });

        const result = await executeBoundedPlayerSearch({
            teamIds: ['team-1'],
            prefixes: ['smith', 'ali'],
            rawQuery: 'smith ali',
            isNumeric: false,
            runNameQuery,
            runNumberQuery: vi.fn(),
            queryLimit: playerSearchResultLimit,
        });

        expect(runNameQuery).toHaveBeenNthCalledWith(1, 'team-1', 'smith');
        expect(runNameQuery).toHaveBeenNthCalledWith(2, 'team-1', 'ali');
        expect(result.snapshots).toHaveLength(2);
        expect(result.completedAllQueries).toBe(true);
    });
});
