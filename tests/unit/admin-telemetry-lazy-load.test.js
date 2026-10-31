// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import {
    loadTelemetryOnTabActivation,
    reloadTelemetryDashboard
} from '../../js/admin-telemetry-lazy-load.js';

const adminDbMocks = vi.hoisted(() => ({
    getAdminTeamsPage: vi.fn(),
    getAdminUsersPage: vi.fn(),
    searchAdminUsers: vi.fn(),
    getGames: vi.fn(),
    getOfficials: vi.fn(),
    getOfficialsForUsers: vi.fn(),
    addOfficial: vi.fn(),
    updateOfficial: vi.fn(),
    deleteOfficial: vi.fn(),
    deleteTeam: vi.fn(),
    getTelemetryEvents: vi.fn(),
    getTelemetryDaily: vi.fn(),
    getTelemetryPageDaily: vi.fn(),
    getTelemetryRouteDaily: vi.fn(),
    getTelemetryEventDaily: vi.fn(),
    getTelemetrySessions: vi.fn()
}));
const adminFirebaseMocks = vi.hoisted(() => ({
    db: {},
    collection: vi.fn(),
    documentId: vi.fn(),
    getDocs: vi.fn(),
    doc: vi.fn(),
    limit: vi.fn(),
    orderBy: vi.fn(),
    query: vi.fn(),
    setDoc: vi.fn(),
    startAfter: vi.fn(),
    updateDoc: vi.fn(),
    serverTimestamp: vi.fn()
}));
const adminAuthMocks = vi.hoisted(() => ({
    callback: null,
    checkAuth: vi.fn((callback) => {
        adminAuthMocks.callback = callback;
    })
}));

vi.mock('../../js/db.js?v=4433207', () => adminDbMocks);
vi.mock('../../js/firebase.js?v=33', () => adminFirebaseMocks);
vi.mock('../../js/utils.js?v=443383', () => ({
    renderHeader: vi.fn(),
    renderFooter: vi.fn(),
    escapeHtml: (value) => String(value || '')
}));
vi.mock('../../js/auth.js?v=4433211', () => adminAuthMocks);
vi.mock('../../js/admin-premium-access-control.js?v=7', () => ({
    createAdminPremiumAccessControl: () => ({ load: vi.fn() })
}));

describe('admin telemetry loading lifecycle', () => {
    it('loads all telemetry sources only on first Telemetry activation and reloads explicitly', async () => {
        const telemetryLoaders = [
            vi.fn().mockResolvedValue([]),
            vi.fn().mockResolvedValue([]),
            vi.fn().mockResolvedValue([]),
            vi.fn().mockResolvedValue([]),
            vi.fn().mockResolvedValue([]),
            vi.fn().mockResolvedValue([])
        ];
        const telemetryState = { loaded: false, loading: false };
        const loadTelemetryData = vi.fn(async () => {
            telemetryState.loading = true;
            await Promise.all(telemetryLoaders.map((loader) => loader()));
            telemetryState.loading = false;
            telemetryState.loaded = true;
        });
        const updateTelemetryDashboard = vi.fn();
        const activateTab = (tab) => loadTelemetryOnTabActivation({
            tab,
            telemetryState,
            loadTelemetryData,
            updateTelemetryDashboard
        });

        await activateTab('dashboard');
        await activateTab('teams');
        await activateTab('users');

        expect(loadTelemetryData).not.toHaveBeenCalled();
        telemetryLoaders.forEach((loader) => expect(loader).not.toHaveBeenCalled());

        await activateTab('telemetry');

        expect(loadTelemetryData).toHaveBeenCalledTimes(1);
        telemetryLoaders.forEach((loader) => expect(loader).toHaveBeenCalledTimes(1));
        expect(updateTelemetryDashboard).toHaveBeenCalledTimes(1);

        await activateTab('dashboard');
        await activateTab('telemetry');

        expect(loadTelemetryData).toHaveBeenCalledTimes(1);
        telemetryLoaders.forEach((loader) => expect(loader).toHaveBeenCalledTimes(1));
        expect(updateTelemetryDashboard).toHaveBeenCalledTimes(1);

        await reloadTelemetryDashboard({ loadTelemetryData, updateTelemetryDashboard });
        await reloadTelemetryDashboard({ loadTelemetryData, updateTelemetryDashboard });

        expect(loadTelemetryData).toHaveBeenCalledTimes(3);
        telemetryLoaders.forEach((loader) => expect(loader).toHaveBeenCalledTimes(3));
        expect(updateTelemetryDashboard).toHaveBeenCalledTimes(3);
    });

    it('keeps the admin bootstrap free of telemetry reads and wires all six loaders behind the tab boundary', () => {
        const adminJs = fs.readFileSync('js/admin.js', 'utf8');
        const loadDataBody = adminJs.match(/async function loadData\(\)[\s\S]*?let allGames = \[\];/)?.[0] || '';
        const loadTelemetryBody = adminJs.match(/async function loadTelemetryData[\s\S]*?function updateDashboard/)?.[0] || '';
        const handleTabBody = adminJs.match(/async function handleTabChange[\s\S]*?function setupTabs/)?.[0] || '';
        const setupSearchBody = adminJs.match(/function setupSearch[\s\S]*?function getTeamOwnerEmail/)?.[0] || '';

        expect(loadDataBody).not.toContain('loadTelemetryData');
        expect(loadDataBody).not.toContain('telemetryPromise');
        [
            'getTelemetryEvents({ days, maxEvents })',
            'getTelemetryDaily({ days })',
            'getTelemetryPageDaily({ days })',
            'getTelemetryRouteDaily({ days })',
            'getTelemetryEventDaily({ days })',
            'getTelemetrySessions({ maxSessions: 300 })'
        ].forEach((loaderCall) => expect(loadTelemetryBody).toContain(loaderCall));
        expect(handleTabBody).toContain('loadTelemetryOnTabActivation({');
        expect(setupSearchBody.match(/reloadTelemetryDashboard\(\{/g)).toHaveLength(2);
    });

    it('performs zero telemetry reads across non-telemetry tabs, then loads and renders on demand', async () => {
        vi.clearAllMocks();
        adminAuthMocks.callback = null;
        document.documentElement.innerHTML = fs.readFileSync('admin.html', 'utf8');
        adminDbMocks.getAdminTeamsPage.mockResolvedValue({
            teams: [{ id: 'team-1', name: 'Test Team', active: true }],
            nextCursor: null
        });
        adminDbMocks.getAdminUsersPage.mockResolvedValue({
            users: [{ id: 'user-1', email: 'user@example.com' }],
            nextCursor: null
        });
        adminDbMocks.getGames.mockResolvedValue([]);
        adminDbMocks.getOfficials.mockResolvedValue([]);
        adminDbMocks.getOfficialsForUsers.mockResolvedValue([]);
        adminDbMocks.getTelemetryEvents
            .mockResolvedValueOnce([{ id: 'event-1', name: 'page_view', userId: 'user-1' }])
            .mockResolvedValue([
                { id: 'event-1', name: 'page_view', userId: 'user-1' },
                { id: 'event-2', name: 'interaction', userId: 'user-1' }
            ]);
        adminDbMocks.getTelemetryDaily.mockResolvedValue([{
            date: '2026-10-19',
            totalEvents: 7,
            pageViews: 4,
            interactions: 2,
            errors: 1
        }]);
        adminDbMocks.getTelemetryPageDaily.mockResolvedValue([]);
        adminDbMocks.getTelemetryRouteDaily.mockResolvedValue([]);
        adminDbMocks.getTelemetryEventDaily.mockResolvedValue([]);
        adminDbMocks.getTelemetrySessions.mockResolvedValue([{ id: 'session-1', eventCount: 7 }]);

        vi.resetModules();
        await import('../../js/admin.js');
        await adminAuthMocks.callback({ uid: 'admin-1', email: 'admin@example.com', isAdmin: true });

        for (const tab of ['dashboard', 'teams', 'users']) {
            document.getElementById(`tab-${tab}`).click();
        }
        await vi.waitFor(() => {
            expect(adminDbMocks.getOfficialsForUsers).toHaveBeenCalled();
        });

        const telemetryLoaders = [
            adminDbMocks.getTelemetryEvents,
            adminDbMocks.getTelemetryDaily,
            adminDbMocks.getTelemetryPageDaily,
            adminDbMocks.getTelemetryRouteDaily,
            adminDbMocks.getTelemetryEventDaily,
            adminDbMocks.getTelemetrySessions
        ];
        telemetryLoaders.forEach((loader) => expect(loader).not.toHaveBeenCalled());

        document.getElementById('tab-telemetry').click();
        await vi.waitFor(() => {
            telemetryLoaders.forEach((loader) => expect(loader).toHaveBeenCalledTimes(1));
            expect(document.getElementById('telemetry-total-events').textContent).toBe('7');
            expect(document.getElementById('telemetry-page-views').textContent).toBe('4');
        });

        document.getElementById('tab-dashboard').click();
        document.getElementById('tab-telemetry').click();
        await Promise.resolve();
        telemetryLoaders.forEach((loader) => expect(loader).toHaveBeenCalledTimes(1));

        document.getElementById('telemetry-refresh').click();
        await vi.waitFor(() => {
            telemetryLoaders.forEach((loader) => expect(loader).toHaveBeenCalledTimes(2));
            expect(document.getElementById('telemetry-status').textContent).toContain('Loaded 2 raw events');
        });

        const range = document.getElementById('telemetry-range');
        range.value = '30';
        range.dispatchEvent(new Event('change'));
        await vi.waitFor(() => {
            telemetryLoaders.forEach((loader) => expect(loader).toHaveBeenCalledTimes(3));
            expect(adminDbMocks.getTelemetryEvents).toHaveBeenLastCalledWith({ days: 30, maxEvents: 5000 });
        });
    });
});
