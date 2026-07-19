/** @vitest-environment jsdom */
/** @vitest-environment-options {"url":"https://allplays.ai/"} */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

const mockFetch = vi.fn(() => Promise.resolve({ ok: true }));
const mockSendBeacon = vi.fn(() => true);
const appCheckMocks = vi.hoisted(() => ({
    getPrimaryAppCheckHeaders: vi.fn(async (headers) => ({ ...headers }))
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

vi.mock('../../js/firebase-app-check-rest.js?v=1', () => ({
    getPrimaryAppCheckHeaders: appCheckMocks.getPrimaryAppCheckHeaders
}));

describe('telemetry.js payload handling', () => {
    let telemetryModule;

    beforeEach(async () => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.useFakeTimers();

        mockFetch.mockReset();
        mockFetch.mockResolvedValue({ ok: true });
        mockSendBeacon.mockReset();
        mockSendBeacon.mockReturnValue(true);

        delete window.__allplaysTelemetry;
        appCheckMocks.getPrimaryAppCheckHeaders.mockReset();
        appCheckMocks.getPrimaryAppCheckHeaders.mockImplementation(async (headers) => ({ ...headers }));

        window.__ALLPLAYS_CONFIG__ = { telemetryEndpoint: 'http://mock-telemetry-endpoint.com' };
        window.history.replaceState({}, '', '/?telemetry=1');
        Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
        window.sessionStorage.clear();
        window.sessionStorage.setItem('allplays.telemetry.session', JSON.stringify({
            id: 'unit-session-2173',
            startedAt: Date.now(),
            lastSeen: Date.now()
        }));

        telemetryModule = await import('../../js/telemetry.js');
        await telemetryModule.flush();
        mockFetch.mockClear();
        appCheckMocks.getPrimaryAppCheckHeaders.mockClear();
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('never sends auth identity or persistent visitor data', async () => {
        telemetryModule.captureTelemetryEvent('test_event_privacy', {
            property: 'private value',
            teamId: 'team-secret'
        });

        await telemetryModule.flush();

        expect(mockFetch).toHaveBeenCalledTimes(1);

        const [url, options] = mockFetch.mock.calls[0];
        const payload = JSON.parse(options.body);
        expect(url).toBe('http://mock-telemetry-endpoint.com');
        expect(options.headers.Authorization).toBeUndefined();
        expect(payload.authToken).toBeUndefined();
        expect(payload.events).toHaveLength(1);
        expect(payload.events[0]).toMatchObject({
            name: 'test_event_privacy',
            userId: null,
            pageTitle: '',
            queryKeys: [],
            userAgent: '',
            properties: {
                property: '[redacted-text]',
                teamId: '[id]',
                deviceClass: 'desktop'
            }
        });
        expect(payload.events[0].visitorId).toBe(payload.events[0].sessionId);
        expect(window.localStorage.setItem).not.toHaveBeenCalledWith(
            'allplays.telemetry.visitor', expect.anything()
        );
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
        for (let i = 0; i < 32; i += 1) {
            telemetryModule.captureTelemetryEvent(`burst_event_${i}`);
        }
        mockSendBeacon.mockClear();
        mockFetch.mockClear();

        await telemetryModule.flush(true);

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

    it('starts an unload beacon synchronously without waiting for App Check', async () => {
        appCheckMocks.getPrimaryAppCheckHeaders.mockImplementation(() => new Promise(() => {}));
        telemetryModule.captureTelemetryEvent('app_workflow_timing', { workflowName: 'page teardown' });
        mockSendBeacon.mockClear();
        appCheckMocks.getPrimaryAppCheckHeaders.mockClear();

        const flushPromise = telemetryModule.flush(true);

        expect(mockSendBeacon).toHaveBeenCalledTimes(1);
        expect(appCheckMocks.getPrimaryAppCheckHeaders).not.toHaveBeenCalled();
        await expect(flushPromise).resolves.toBeUndefined();
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

    it('backs off and stops after three failed delivery attempts', async () => {
        mockFetch.mockRejectedValue(new Error('telemetry endpoint unavailable'));
        telemetryModule.captureTelemetryEvent('bounded_retry_test');

        await telemetryModule.flush();
        expect(mockFetch).toHaveBeenCalledTimes(1);

        await telemetryModule.flush();
        expect(mockFetch).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(999);
        expect(mockFetch).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(mockFetch).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(1_999);
        expect(mockFetch).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(mockFetch).toHaveBeenCalledTimes(3);

        await vi.advanceTimersByTimeAsync(10_000);
        await telemetryModule.flush();
        expect(mockFetch).toHaveBeenCalledTimes(3);
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
            pagePath: '/app',
            appRoute: '/players/:id/:id',
            queryKeys: [],
            appRouteQueryKeys: [],
            properties: { property: '[redacted-text]', deviceClass: 'desktop' }
        });
    });

    it('deduplicates repeated error fingerprints for one minute', async () => {
        vi.setSystemTime(0);
        telemetryModule.captureTelemetryEvent('js_error', {
            errorName: 'TypeError', errorType: 'runtime', source: '/app/main.js', line: 12
        });
        telemetryModule.captureTelemetryEvent('js_error', {
            errorName: 'TypeError', errorType: 'runtime', source: '/app/main.js', line: 12
        });
        await telemetryModule.flush();

        const events = mockFetch.mock.calls.flatMap(([, options]) => JSON.parse(options.body).events);
        expect(events.filter((event) => event.name === 'js_error')).toHaveLength(1);
        expect(events.find((event) => event.name === 'js_error')).toMatchObject({ sampleRate: 1, sampleWeight: 1 });
    });

    it('does not deduplicate distinct explicit workflow signals', async () => {
        telemetryModule.captureTelemetryEvent('app_workflow_timing', { workflowName: 'first workflow' });
        telemetryModule.captureTelemetryEvent('app_workflow_timing', { workflowName: 'second workflow' });
        await telemetryModule.flush();

        const events = mockFetch.mock.calls.flatMap(([, options]) => JSON.parse(options.body).events);
        expect(events.filter((event) => event.name === 'app_workflow_timing')).toHaveLength(2);
    });

    it('keeps distinct low-value signals when no privacy-safe control identity exists', async () => {
        telemetryModule.captureTelemetryEvent('interaction_click', { tagName: 'button' });
        telemetryModule.captureTelemetryEvent('interaction_click', { tagName: 'button' });
        telemetryModule.captureTelemetryEvent('scroll_depth', { depthPercent: 25 });
        telemetryModule.captureTelemetryEvent('scroll_depth', { depthPercent: 50 });
        telemetryModule.captureTelemetryEvent('interaction_click', { telemetryName: 'save' });
        telemetryModule.captureTelemetryEvent('interaction_click', { telemetryName: 'save' });
        telemetryModule.captureTelemetryEvent('interaction_change', { telemetryName: 'notifications', hasValue: true });
        telemetryModule.captureTelemetryEvent('interaction_change', { telemetryName: 'notifications', hasValue: false });
        await telemetryModule.flush();

        const events = mockFetch.mock.calls.flatMap(([, options]) => JSON.parse(options.body).events);
        expect(events.filter((event) => event.name === 'interaction_click' && !event.properties.telemetryName)).toHaveLength(2);
        expect(events.filter((event) => event.name === 'scroll_depth').map((event) => event.properties.depthPercent)).toEqual([25, 50]);
        expect(events.filter((event) => event.name === 'interaction_click' && event.properties.telemetryName === 'save')).toHaveLength(1);
        expect(events.filter((event) => event.name === 'interaction_change').map((event) => event.properties.hasValue)).toEqual([true, false]);
    });

    it('keeps explicit workflow baselines at full sampling', async () => {
        telemetryModule.captureTelemetryEvent('app_workflow_timing', { workflowName: 'schedule create game' });
        telemetryModule.captureTelemetryEvent('app_ux_timing', { label: 'schedule load' });
        await telemetryModule.flush();

        const events = mockFetch.mock.calls.flatMap(([, options]) => JSON.parse(options.body).events);
        expect(events.filter((event) => event.name === 'app_workflow_timing')[0]).toMatchObject({ sampleRate: 1, sampleWeight: 1 });
        expect(events.filter((event) => event.name === 'app_ux_timing')[0]).toMatchObject({ sampleRate: 1, sampleWeight: 1 });
    });
});
