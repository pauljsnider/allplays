// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../../js/db.js?v=74', () => dbMocks);
vi.mock('../../js/firebase.js?v=19', () => firebaseMocks);
vi.mock('../../js/utils.js?v=8', () => ({
    escapeHtml: (value) => String(value || '')
}));
vi.mock('../../js/global-search-visibility.js?v=2', () => ({
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

async function flushAsyncWork() {
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();
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
        const { setupHeaderSearch } = await import('../../js/global-search.js?v=8');

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
        const { setupHeaderSearch } = await import('../../js/global-search.js?v=8');

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
        const { setupHeaderSearch } = await import('../../js/global-search.js?v=8');

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
});
