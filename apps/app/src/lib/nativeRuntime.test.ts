// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const capacitorCoreMock = vi.hoisted(() => ({
    isNativePlatform: vi.fn(() => false),
    getPlatform: vi.fn(() => 'web')
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: capacitorCoreMock
}));

import { isNativeRuntime } from './nativeRuntime';

describe('isNativeRuntime', () => {
    const originalLocation = window.location;

    beforeEach(() => {
        capacitorCoreMock.isNativePlatform.mockReturnValue(false);
        capacitorCoreMock.getPlatform.mockReturnValue('web');
    });

    afterEach(() => {
        Object.defineProperty(window, 'location', { value: originalLocation, writable: true, configurable: true });
    });

    it('returns true when Capacitor reports a native platform', () => {
        capacitorCoreMock.isNativePlatform.mockReturnValue(true);
        expect(isNativeRuntime()).toBe(true);
    });

    it('returns true when running under the capacitor: protocol even if Capacitor.isNativePlatform() misses it', () => {
        capacitorCoreMock.isNativePlatform.mockReturnValue(false);
        capacitorCoreMock.getPlatform.mockReturnValue('ios');
        Object.defineProperty(window, 'location', {
            value: { ...originalLocation, protocol: 'capacitor:' },
            writable: true,
            configurable: true
        });

        expect(isNativeRuntime()).toBe(true);
    });

    it('returns true for Capacitor Android at https://localhost when the platform reports Android', () => {
        capacitorCoreMock.isNativePlatform.mockReturnValue(false);
        capacitorCoreMock.getPlatform.mockReturnValue('android');
        Object.defineProperty(window, 'location', {
            value: { ...originalLocation, protocol: 'https:', hostname: 'localhost' },
            writable: true,
            configurable: true
        });

        expect(isNativeRuntime()).toBe(true);
    });

    it('returns false for an ordinary HTTPS localhost browser without a native platform', () => {
        capacitorCoreMock.isNativePlatform.mockReturnValue(false);
        capacitorCoreMock.getPlatform.mockReturnValue('web');
        Object.defineProperty(window, 'location', {
            value: { ...originalLocation, protocol: 'https:', hostname: 'localhost' },
            writable: true,
            configurable: true
        });

        expect(isNativeRuntime()).toBe(false);
    });

    it('returns false in a regular web browser', () => {
        capacitorCoreMock.isNativePlatform.mockReturnValue(false);
        Object.defineProperty(window, 'location', {
            value: { ...originalLocation, protocol: 'https:', hostname: 'allplays.ai' },
            writable: true,
            configurable: true
        });

        expect(isNativeRuntime()).toBe(false);
    });
});
