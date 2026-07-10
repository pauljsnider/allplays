import { describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_ADMIN_PAGE_SIZE,
    buildBoundedAdminDashboardScope,
    loadAdminCollectionPage,
    loadInitialAdminBootstrap
} from '../../js/admin-bootstrap.js';

describe('admin bootstrap paging helpers', () => {
    it('caps dashboard scope independently of the supplied platform collection sizes', () => {
        const teams = Array.from({ length: 250 }, (_, index) => ({ id: `team-${index + 1}` }));
        const users = Array.from({ length: 400 }, (_, index) => ({ id: `user-${index + 1}` }));

        const scope = buildBoundedAdminDashboardScope({ teams, users });

        expect(scope.teams).toHaveLength(DEFAULT_ADMIN_PAGE_SIZE);
        expect(scope.users).toHaveLength(DEFAULT_ADMIN_PAGE_SIZE);
        expect(scope.teams.at(-1)?.id).toBe(`team-${DEFAULT_ADMIN_PAGE_SIZE}`);
        expect(scope.users.at(-1)?.id).toBe(`user-${DEFAULT_ADMIN_PAGE_SIZE}`);
    });

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
