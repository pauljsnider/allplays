/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock fetch and sendBeacon
const mockFetch = vi.fn(() => Promise.resolve({ ok: true }));
const mockSendBeacon = vi.fn(() => true);

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

describe('telemetry.js payload handling', () => {
    let telemetryModule;
    let getAuthTokenSpy;
    let sendEventsSpy;

    beforeEach(async () => {
        vi.resetModules(); // Reset module cache
        delete window.__allplaysTelemetry; // Clear the global telemetry flag

        vi.clearAllMocks();
        vi.useFakeTimers();

        // Ensure endpoint is resolved for tests
        window.__ALLPLAYS_CONFIG__ = { telemetryEndpoint: 'http://mock-telemetry-endpoint.com' };

        // Force telemetry to be enabled for testing
        Object.defineProperty(window, 'location', {
            value: {
                ...window.location,
                hostname: 'allplays.com', // Not local development
                search: '?telemetry=1' // Force enable
            },
            writable: true
        });

        // Re-import telemetry.js after mocks are set up to ensure it picks up the mocks
        telemetryModule = await import('../../js/telemetry.js');

        // Spy on both sendEvents and getAuthToken
        sendEventsSpy = vi.spyOn(telemetryModule, 'sendEvents');
        getAuthTokenSpy = vi.spyOn(telemetryModule, 'getAuthToken');

        // Restore original implementation for sendEvents so it calls getAuthToken and fetch
        // This is crucial for the original logic to execute while still being able to spy
        sendEventsSpy.mockImplementation(sendEventsSpy.originalImplementation);

        // Ensure document.readyState is 'complete' or fire DOMContentLoaded to trigger capturePageView
        Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
        window.document.dispatchEvent(new Event('DOMContentLoaded'));
        await vi.runAllTimers(); // Process any pending timers from initialization
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.restoreAllMocks();
    });

    it('should send telemetry with authToken for authenticated users', async () => {
        getAuthTokenSpy.mockResolvedValue('mockAuthToken456');

        telemetryModule.captureTelemetryEvent('test_event_auth', { property: 'value' });

        await telemetryModule.flush();

        expect(sendEventsSpy).toHaveBeenCalled();
        expect(getAuthTokenSpy).toHaveBeenCalled();
        expect(mockFetch).toHaveBeenCalledWith(
            'http://mock-telemetry-endpoint.com',
            expect.objectContaining({
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer mockAuthToken456'
                },
                body: expect.stringContaining('"authToken":"mockAuthToken456"')
            })
        );

        const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(payload.authToken).toBe('mockAuthToken456');
        expect(payload.events[0].name).toBe('test_event_auth');
    });

    it('should send telemetry WITHOUT authToken for unauthenticated users', async () => {
        getAuthTokenSpy.mockResolvedValue(null);

        telemetryModule.captureTelemetryEvent('test_event_unauth', { property: 'value' });

        await telemetryModule.flush();

        expect(sendEventsSpy).toHaveBeenCalled();
        expect(getAuthTokenSpy).toHaveBeenCalled();
        expect(mockFetch).toHaveBeenCalledWith(
            'http://mock-telemetry-endpoint.com',
            expect.objectContaining({
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                    // No Authorization header expected
                },
                body: expect.not.stringContaining('"authToken"') // Key should be absent
            })
        );

        const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(payload).not.toHaveProperty('authToken');
        expect(payload.events[0].name).toBe('test_event_unauth');
    });
});