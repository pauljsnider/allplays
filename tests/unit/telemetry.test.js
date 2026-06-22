/** @vitest-environment jsdom */
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

vi.mock('../../js/firebase.js?v=19', () => {
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
});
