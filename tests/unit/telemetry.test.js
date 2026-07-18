/** @vitest-environment jsdom */
/** @vitest-environment-options {"url":"https://allplays.ai/"} */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

const mockFetch = vi.fn(() => Promise.resolve({ ok: true }));
const mockSendBeacon = vi.fn(() => true);
const firebaseMocks = vi.hoisted(() => ({
    auth: { currentUser: null },
    getIdToken: vi.fn(),
    onAuthStateChanged: vi.fn()
}));

Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    value: mockSendBeacon
});
Object.defineProperty(window, 'fetch', {
    configurable: true,
    value: mockFetch
});

// Mock sessionStorage and localStorage to avoid errors in JSDOM
const mockStorage = () => {
    let store = {};
    return {
        getItem: vi.fn((key) => store[key] || null),
        setItem: vi.fn((key, value) => {
            store[key] = value.toString();
        }),
        removeItem: vi.fn((key) => {
            delete store[key];
        }),
        clear: vi.fn(() => {
            store = {};
        })
    };
};

Object.defineProperty(window, 'localStorage', { value: mockStorage() });
Object.defineProperty(window, 'sessionStorage', { value: mockStorage() });

vi.mock('../../js/firebase.js?v=22', () => {
    return {
        auth: firebaseMocks.auth,
        onAuthStateChanged: firebaseMocks.onAuthStateChanged
    };
});

describe('telemetry.js payload handling', () => {
    let telemetryModule;

    beforeEach(async () => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.useFakeTimers();

        delete window.__allplaysTelemetry;
        firebaseMocks.auth.currentUser = null;
        firebaseMocks.getIdToken.mockReset();
        firebaseMocks.onAuthStateChanged.mockReset();

        window.__ALLPLAYS_CONFIG__ = { telemetryEndpoint: 'http://mock-telemetry-endpoint.com' };
        window.history.replaceState({}, '', '/?telemetry=1');
        Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });

        telemetryModule = await import('../../js/telemetry.js');
        await telemetryModule.flush();
        mockFetch.mockClear();
        firebaseMocks.getIdToken.mockClear();
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('should send telemetry with authToken for authenticated users', async () => {
        firebaseMocks.getIdToken.mockResolvedValue('mockAuthToken456');
        firebaseMocks.auth.currentUser = { getIdToken: firebaseMocks.getIdToken };

        telemetryModule.captureTelemetryEvent('test_event_auth', { property: 'value' });

        await telemetryModule.flush();

        expect(firebaseMocks.getIdToken).toHaveBeenCalled();
        expect(mockFetch).toHaveBeenCalledTimes(1);

        const [url, options] = mockFetch.mock.calls[0];
        const payload = JSON.parse(options.body);
        expect(url).toBe('http://mock-telemetry-endpoint.com');
        expect(options.headers.Authorization).toBe('Bearer mockAuthToken456');
        expect(payload.authToken).toBe('mockAuthToken456');
        expect(payload.events).toHaveLength(1);
        expect(payload.events[0].name).toBe('test_event_auth');
        expect(payload.events[0].properties).toEqual({ property: 'value' });
    });

    it('should send telemetry WITHOUT authToken for unauthenticated users', async () => {
        telemetryModule.captureTelemetryEvent('test_event_unauth', { property: 'value' });

        await telemetryModule.flush();

        expect(mockFetch).toHaveBeenCalledTimes(1);

        const [, options] = mockFetch.mock.calls[0];
        const payload = JSON.parse(options.body);
        expect(options.headers.Authorization).toBeUndefined();
        expect(payload.authToken).toBeUndefined();
        expect(payload.events).toHaveLength(1);
        expect(payload.events[0].name).toBe('test_event_unauth');
        expect(payload.events[0].properties).toEqual({ property: 'value' });
    });

    it('starts telemetry from explicit enabled config without a query override', async () => {
        vi.resetModules();
        delete window.__allplaysTelemetry;
        delete window.ALLPLAYS_TELEMETRY_ENABLED;
        window.localStorage.clear();
        window.sessionStorage.clear();
        window.__ALLPLAYS_CONFIG__ = {
            enabled: true,
            telemetryEndpoint: 'http://mock-telemetry-endpoint.com'
        };
        window.history.replaceState({}, '', '/');
        mockFetch.mockClear();

        const enabledConfigModule = await import('../../js/telemetry.js');
        enabledConfigModule.captureTelemetryEvent('explicit_config_enabled');
        await enabledConfigModule.flush();

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [, options] = mockFetch.mock.calls[0];
        const payload = JSON.parse(options.body);
        expect(payload.events.map((event) => event.name)).toContain('explicit_config_enabled');
    });

    it('starts telemetry by default on production hosts without explicit config', async () => {
        vi.resetModules();
        delete window.__allplaysTelemetry;
        delete window.ALLPLAYS_TELEMETRY_ENABLED;
        window.localStorage.clear();
        window.sessionStorage.clear();
        window.__ALLPLAYS_CONFIG__ = {
            telemetryEndpoint: 'http://mock-telemetry-endpoint.com'
        };
        window.history.replaceState({}, '', '/dashboard.html');
        mockFetch.mockClear();

        const defaultProductionModule = await import('../../js/telemetry.js');
        defaultProductionModule.captureTelemetryEvent('production_default_enabled');
        await defaultProductionModule.flush();

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [, options] = mockFetch.mock.calls[0];
        const payload = JSON.parse(options.body);
        expect(payload.events.map((event) => event.name)).toContain('production_default_enabled');
    });

    it('drains the whole queue via unauthenticated beacons on keepalive flush', async () => {
        // Page-close flush cannot risk a stale cached token rejecting the batch.
        firebaseMocks.getIdToken.mockResolvedValue('mockAuthToken456');
        firebaseMocks.auth.currentUser = { getIdToken: firebaseMocks.getIdToken };

        telemetryModule.captureTelemetryEvent('warm_auth_cache');
        await telemetryModule.flush();

        for (let i = 0; i < 32; i += 1) {
            telemetryModule.captureTelemetryEvent(`burst_event_${i}`);
        }
        mockSendBeacon.mockClear();
        mockFetch.mockClear();
        firebaseMocks.getIdToken.mockClear();

        await telemetryModule.flush(true);

        expect(firebaseMocks.getIdToken).not.toHaveBeenCalled();
        expect(mockFetch).not.toHaveBeenCalled();
        expect(mockSendBeacon.mock.calls.length).toBeGreaterThanOrEqual(3);
        const allPayloads = await Promise.all(mockSendBeacon.mock.calls.map(async ([, blob]) => JSON.parse(await blob.text())));
        const names = allPayloads.flatMap((payload) => payload.events.map((event) => event.name));
        expect(names).toHaveLength(32);
        expect(names).toContain('burst_event_0');
        expect(names).toContain('burst_event_31');
        allPayloads.forEach((payload) => {
            expect(payload.authToken).toBeUndefined();
        });
    });

    it('buffers bursts larger than the old 40-event cap without dropping', async () => {
        for (let i = 0; i < 60; i += 1) {
            telemetryModule.captureTelemetryEvent(`queued_event_${i}`);
        }
        mockFetch.mockClear();

        // Drain with repeated normal flushes; every queued event must survive.
        for (let i = 0; i < 6; i += 1) {
            await telemetryModule.flush();
        }

        const names = mockFetch.mock.calls
            .map(([, options]) => JSON.parse(options.body))
            .flatMap((payload) => payload.events.map((event) => event.name))
            .filter((name) => name.startsWith('queued_event_'));
        expect(names).toHaveLength(60);
        expect(names).toContain('queued_event_0');
        expect(names).toContain('queued_event_59');
    });

    it('adds app route context to stored events for hash-routed app screens', async () => {
        window.history.replaceState({}, '', '/app/?telemetry=1#/players/team-1/player-1?teamId=team-1&from=home');

        telemetryModule.captureTelemetryEvent('route_context_test', { property: 'value' });

        await telemetryModule.flush();

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [, options] = mockFetch.mock.calls[0];
        const payload = JSON.parse(options.body);
        const routeEvent = payload.events.find((event) => event.name === 'route_context_test');
        expect(routeEvent).toMatchObject({
            name: 'route_context_test',
            pagePath: '/app/',
            appRoute: '/players/team-1/player-1',
            queryKeys: ['telemetry'],
            appRouteQueryKeys: ['teamId', 'from'],
            properties: { property: 'value' }
        });
    });
});
