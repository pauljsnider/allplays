import { describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_ADMIN_PAGE_SIZE,
    loadAdminCollectionPage,
    loadInitialAdminBootstrap
} from '../../js/admin-bootstrap.js';

describe('admin bootstrap paging helpers', () => {
    it('uses a fixed first-page size and reuses returned cursors for follow-up loads', async () => {
        const firstCursor = { id: 'cursor-1' };
        const fetchPage = vi.fn()
            .mockResolvedValueOnce({ items: ['first'], nextCursor: firstCursor })
            .mockResolvedValueOnce({ items: ['second'], nextCursor: null });

        const firstPage = await loadAdminCollectionPage({ fetchPage });
        const secondPage = await loadAdminCollectionPage({ fetchPage, cursor: firstPage.nextCursor });

        expect(fetchPage).toHaveBeenNthCalledWith(1, {
            cursor: null,
            pageSize: DEFAULT_ADMIN_PAGE_SIZE
        });
        expect(fetchPage).toHaveBeenNthCalledWith(2, {
            cursor: firstCursor,
            pageSize: DEFAULT_ADMIN_PAGE_SIZE
        });
        expect(secondPage.items).toEqual(['second']);
    });

    it('keeps initial bootstrap bounded to top-level pages and telemetry', async () => {
        const getTeamsPage = vi.fn().mockResolvedValue({ teams: [{ id: 'team-1' }], nextCursor: { id: 'team-cursor' } });
        const getUsersPage = vi.fn().mockResolvedValue({ users: [{ id: 'user-1' }], nextCursor: { id: 'user-cursor' } });
        const loadTelemetryData = vi.fn().mockResolvedValue(undefined);
        const getGames = vi.fn();
        const getOfficials = vi.fn();

        const result = await loadInitialAdminBootstrap({
            getTeamsPage,
            getUsersPage,
            loadTelemetryData,
            getGames,
            getOfficials
        });
        await result.telemetryPromise;

        expect(getTeamsPage).toHaveBeenCalledWith({ cursor: null, pageSize: DEFAULT_ADMIN_PAGE_SIZE });
        expect(getUsersPage).toHaveBeenCalledWith({ cursor: null, pageSize: DEFAULT_ADMIN_PAGE_SIZE });
        expect(loadTelemetryData).toHaveBeenCalledWith({ silent: true });
        expect(getGames).not.toHaveBeenCalled();
        expect(getOfficials).not.toHaveBeenCalled();
    });
});
