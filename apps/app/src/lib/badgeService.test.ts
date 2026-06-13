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

const chatServiceMocks = vi.hoisted(() => ({
    loadChatInbox: vi.fn().mockResolvedValue({ teams: [] }),
    markTeamChatRead: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: capacitorCoreMock
}));

vi.mock('./chatService', () => chatServiceMocks);

// @capawesome/capacitor-badge is dynamically imported inside updateAppIconBadge, so we
// mock the module so the dynamic import resolves to our stub.
vi.mock('@capawesome/capacitor-badge', () => ({
    Badge: badgeMocks
}));

import { markTeamChatReadAndRefreshBadge, refreshUnreadChatBadge, updateAppIconBadge } from './badgeService';

describe('updateAppIconBadge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        chatServiceMocks.loadChatInbox.mockResolvedValue({ teams: [] });
        chatServiceMocks.markTeamChatRead.mockResolvedValue(undefined);
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
        await updateAppIconBadge(5);

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

    it('refreshes the badge count from the unread inbox total on native', async () => {
        chatServiceMocks.loadChatInbox.mockResolvedValue({
            teams: [
                { id: 'team-1', unreadCount: 2 },
                { id: 'team-2', unreadCount: 3 }
            ]
        });

        await refreshUnreadChatBadge({ uid: 'user-1' } as any);

        expect(chatServiceMocks.loadChatInbox).toHaveBeenCalledWith({ uid: 'user-1' }, { includeLastMessages: false });
        expect(badgeMocks.set).toHaveBeenCalledWith({ count: 5 });
    });

    it('marks the direct chat read and then refreshes the unread badge total', async () => {
        chatServiceMocks.loadChatInbox.mockResolvedValue({
            teams: [
                { id: 'team-1', unreadCount: 0 },
                { id: 'team-2', unreadCount: 1 }
            ]
        });

        await markTeamChatReadAndRefreshBadge({ uid: 'user-1' } as any, 'team-1');

        expect(chatServiceMocks.markTeamChatRead).toHaveBeenCalledWith('user-1', 'team-1');
        expect(chatServiceMocks.loadChatInbox).toHaveBeenCalledWith({ uid: 'user-1' }, { includeLastMessages: false });
        expect(badgeMocks.set).toHaveBeenCalledWith({ count: 1 });
    });
});
