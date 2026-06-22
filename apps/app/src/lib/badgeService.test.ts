// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mocks must be declared before any imports.
const badgeMocks = vi.hoisted(() => ({
    set: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined)
}));

const capacitorCoreMock = vi.hoisted(() => ({
    isNativePlatform: vi.fn(() => true)
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: capacitorCoreMock
}));

// @capawesome/capacitor-badge is dynamically imported inside updateAppIconBadge, so we
// mock the module so the dynamic import resolves to our stub.
vi.mock('@capawesome/capacitor-badge', () => ({
    Badge: badgeMocks
}));

import {
    countUnreadNotificationInboxItems,
    normalizeAppIconBadgeCount,
    syncAppIconBadgeToNotificationInbox,
    updateAppIconBadge
} from './badgeService';

describe('normalizeAppIconBadgeCount', () => {
    it('keeps positive integer counts unchanged', () => {
        expect(normalizeAppIconBadgeCount(12)).toBe(12);
    });

    it('floors fractional unread counts before writing to native badge APIs', () => {
        expect(normalizeAppIconBadgeCount(4.9)).toBe(4);
    });

    it('coerces numeric values and clamps invalid or negative counts to zero', () => {
        expect(normalizeAppIconBadgeCount('7')).toBe(7);
        expect(normalizeAppIconBadgeCount(Number.NaN)).toBe(0);
        expect(normalizeAppIconBadgeCount(Number.POSITIVE_INFINITY)).toBe(0);
        expect(normalizeAppIconBadgeCount(-3)).toBe(0);
        expect(normalizeAppIconBadgeCount(undefined)).toBe(0);
    });
});

describe('updateAppIconBadge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default: native platform.
        capacitorCoreMock.isNativePlatform.mockReturnValue(true);
        // Ensure protocol appears non-capacitor so only isNativePlatform governs.
        Object.defineProperty(window, 'location', {
            value: { protocol: 'https:' },
            writable: true,
            configurable: true
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('calls Badge.set with the total unread count when count > 0 on native', async () => {
        await updateAppIconBadge(5.7);

        expect(badgeMocks.set).toHaveBeenCalledWith({ count: 5 });
        expect(badgeMocks.clear).not.toHaveBeenCalled();
    });

    it('calls Badge.clear when unread count reaches zero on native', async () => {
        await updateAppIconBadge(0);

        expect(badgeMocks.clear).toHaveBeenCalled();
        expect(badgeMocks.set).not.toHaveBeenCalled();
    });

    it('is a no-op on non-native (web) platforms', async () => {
        capacitorCoreMock.isNativePlatform.mockReturnValue(false);

        await updateAppIconBadge(3);

        expect(badgeMocks.set).not.toHaveBeenCalled();
        expect(badgeMocks.clear).not.toHaveBeenCalled();
    });

    it('treats a capacitor:// protocol as a native runtime even if isNativePlatform is false', async () => {
        capacitorCoreMock.isNativePlatform.mockReturnValue(false);
        Object.defineProperty(window, 'location', {
            value: { protocol: 'capacitor:' },
            writable: true,
            configurable: true
        });

        await updateAppIconBadge(2);

        expect(badgeMocks.set).toHaveBeenCalledWith({ count: 2 });
    });

    it('swallows errors from the Badge plugin without throwing', async () => {
        badgeMocks.set.mockRejectedValueOnce(new Error('Badge permission denied'));

        await expect(updateAppIconBadge(7)).resolves.toBeUndefined();
    });

    it('counts unread notification inbox items from mixed read states', () => {
        expect(countUnreadNotificationInboxItems([
            { id: 'notif-1', readAt: null } as any,
            { id: 'notif-2', readAt: { seconds: 1 } } as any,
            { id: 'notif-3', readAt: null } as any,
        ])).toBe(2);
    });

    it('syncs the native badge from notification inbox unread items', async () => {
        await syncAppIconBadgeToNotificationInbox([
            { id: 'notif-1', readAt: null } as any,
            { id: 'notif-2', readAt: { seconds: 1 } } as any,
            { id: 'notif-3', readAt: null } as any,
        ]);

        expect(badgeMocks.set).toHaveBeenCalledWith({ count: 2 });
    });

    it('clears the native badge when every notification inbox item is read', async () => {
        await syncAppIconBadgeToNotificationInbox([
            { id: 'notif-1', readAt: { seconds: 1 } } as any,
            { id: 'notif-2', readAt: new Date() } as any,
        ]);

        expect(badgeMocks.clear).toHaveBeenCalled();
    });
});
