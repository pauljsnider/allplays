// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../../apps/app/src/components/AppShell';
import type { AuthState } from '../../apps/app/src/lib/types';

// --- Hoisted mocks ---

const { useShellLayoutMock } = vi.hoisted(() => ({
    useShellLayoutMock: vi.fn(() => ({ isDesktopWeb: true })),
}));

const inboxServiceMocks = vi.hoisted(() => ({
    subscribeToNotificationInbox: vi.fn(() => vi.fn()),
    subscribeToUnreadNotificationCount: vi.fn(() => vi.fn()),
    countUnread: vi.fn((items: Array<{ readAt: unknown }>) => items.filter((i) => !i.readAt).length),
    markNotificationRead: vi.fn(() => Promise.resolve()),
}));

const { loadNotificationInboxServiceMock } = vi.hoisted(() => ({
    loadNotificationInboxServiceMock: vi.fn(() => Promise.resolve(inboxServiceMocks)),
}));

vi.mock('../../apps/app/src/lib/useShellLayout', () => ({
    useShellLayout: useShellLayoutMock,
}));

vi.mock('../../apps/app/src/lib/uxTiming', () => ({
    recordUxTiming: vi.fn(),
}));

vi.mock('../../apps/app/src/lib/nativeBackButton', () => ({
    APP_BACK_DISMISS_EVENT: 'allplays:native-back-dismiss',
    addNativeBackListener: vi.fn(() => ({ remove: vi.fn() })),
}));

vi.mock('../../apps/app/src/lib/notificationInboxServiceLoader', () => ({
    loadNotificationInboxService: loadNotificationInboxServiceMock,
}));

vi.mock('../../apps/app/src/components/AppSearchDialog', () => ({
    AppSearchDialog: ({ open }: { open: boolean }) =>
        open ? <div role="dialog" aria-label="Search teams, players, actions, and help" /> : null,
}));

vi.mock('../../apps/app/src/components/NotificationInboxSheet', () => ({
    NotificationInboxSheet: ({
        items,
        inboxState,
        onClose,
        onMarkRead,
        uid,
    }: {
        items: Array<{ id: string; text: string; appRoute: string; readAt: unknown }>;
        inboxState: 'loading' | 'ready' | 'error';
        uid: string;
        onClose: () => void;
        onMarkRead: (uid: string, itemId: string) => Promise<void>;
    }) => (
        <div role="dialog" aria-label="Notifications" data-testid="notification-inbox-sheet">
            {inboxState === 'loading' && items.length === 0 ? (
                <p data-testid="inbox-loading-state">Loading notifications…</p>
            ) : inboxState === 'error' && items.length === 0 ? (
                <p data-testid="inbox-error-state">Could not load notifications</p>
            ) : items.length === 0 ? (
                <p>No notifications yet</p>
            ) : (
                <>
                    {inboxState === 'error' && (
                        <p data-testid="inbox-error-banner">Could not refresh</p>
                    )}
                    <ul>
                        {items.map((item) => (
                            <li key={item.id}>
                                <button
                                    type="button"
                                    data-testid={`notification-item-${item.id}`}
                                    onClick={() => {
                                        onClose();
                                        void onMarkRead(uid, item.id).catch(() => undefined);
                                    }}
                                >
                                    {item.text}
                                </button>
                            </li>
                        ))}
                    </ul>
                </>
            )}
            <button type="button" onClick={onClose} aria-label="Close notifications">
                Close
            </button>
        </div>
    ),
}));

// --- Auth fixture ---

const auth: AuthState = {
    user: {
        uid: 'user-1',
        email: 'user@example.com',
        displayName: 'Test User',
        roles: ['parent'],
    },
    profile: null,
    loading: false,
    error: null,
    roles: ['parent'],
    isParent: true,
    isCoach: false,
    isAdmin: false,
    isPlatformAdmin: false,
    refresh: vi.fn(),
    signOut: vi.fn(),
};

function LocationDisplay() {
    const location = useLocation();
    return <div data-testid="current-route">{location.pathname}</div>;
}

function renderShell(isDesktop = true, initialPath = '/home') {
    useShellLayoutMock.mockReturnValue({ isDesktopWeb: isDesktop });
    return render(
        <MemoryRouter initialEntries={[initialPath]}>
            <Routes>
                <Route
                    path="/home"
                    element={
                        <AppShell auth={auth}>
                            <>
                                <div>Home content</div>
                                <LocationDisplay />
                            </>
                        </AppShell>
                    }
                />
                <Route
                    path="/messages/:teamId"
                    element={
                        <AppShell auth={auth}>
                            <>
                                <div>Chat thread content</div>
                                <LocationDisplay />
                            </>
                        </AppShell>
                    }
                />
            </Routes>
        </MemoryRouter>
    );
}

// --- Tests ---

describe('Notification bell in AppShell', () => {
    beforeEach(() => {
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        });
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        inboxServiceMocks.subscribeToNotificationInbox.mockReturnValue(vi.fn());
        inboxServiceMocks.subscribeToUnreadNotificationCount.mockReturnValue(vi.fn());
        inboxServiceMocks.markNotificationRead.mockResolvedValue(undefined);
        loadNotificationInboxServiceMock.mockResolvedValue(inboxServiceMocks);
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('renders a notification bell button in the desktop header', () => {
        renderShell(true);
        const bellButton = screen.getByRole('button', { name: 'Notifications' });
        expect(bellButton).toBeTruthy();
        expect(bellButton.getAttribute('data-testid')).toBe('app-shell-notifications-trigger');
    });

    it('renders a notification bell button in the mobile header', () => {
        renderShell(false);
        const bellButton = screen.getByTestId('app-shell-notifications-trigger');
        expect(bellButton.getAttribute('aria-label')).toBe('Notifications');
    });

    it('keeps the notification trigger available on mobile chat detail routes and returns to the same thread after closing the inbox', async () => {
        let onUnreadError: ((error: unknown) => void) | undefined;
        inboxServiceMocks.subscribeToUnreadNotificationCount.mockImplementation(
            (_uid: string, onCount: (count: number) => void, onError?: (error: unknown) => void) => {
                onUnreadError = onError;
                return vi.fn();
            }
        );

        renderShell(false, '/messages/team-1');

        await waitFor(() => {
            expect(inboxServiceMocks.subscribeToUnreadNotificationCount).toHaveBeenCalledWith(
                'user-1',
                expect.any(Function),
                expect.any(Function)
            );
        });

        const bellButton = screen.getByTestId('app-shell-notifications-trigger');
        expect(bellButton.getAttribute('aria-label')).toBe('Notifications');
        const searchButton = screen.getByTestId('app-shell-search-trigger');
        expect(searchButton.getAttribute('aria-label')).toBe('Search');
        expect(screen.getByTestId('current-route').textContent).toBe('/messages/team-1');
        expect(screen.queryByTestId('notification-unread-badge')).toBeNull();

        act(() => {
            onUnreadError?.(new Error('offline'));
        });

        expect(screen.getByTestId('app-shell-notifications-trigger')).toBeTruthy();

        act(() => {
            const onCount = inboxServiceMocks.subscribeToUnreadNotificationCount.mock.calls[0]?.[1] as ((count: number) => void) | undefined;
            onCount?.(3);
        });

        await waitFor(() => {
            expect(screen.getByTestId('notification-unread-badge').textContent).toBe('3');
        });

        fireEvent.click(screen.getByTestId('app-shell-notifications-trigger'));
        await waitFor(() => {
            expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeTruthy();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Close notifications' }));
        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull();
        });
        expect(screen.getByTestId('current-route').textContent).toBe('/messages/team-1');
        expect(screen.getByText('Chat thread content')).toBeTruthy();
    });

    it('subscribes to unread counts on mount and defers the full inbox until opened', async () => {
        renderShell(true);
        await waitFor(() => {
            expect(inboxServiceMocks.subscribeToUnreadNotificationCount).toHaveBeenCalledWith(
                'user-1',
                expect.any(Function),
                expect.any(Function)
            );
        });
        expect(inboxServiceMocks.subscribeToNotificationInbox).not.toHaveBeenCalled();

        fireEvent.click(screen.getByTestId('app-shell-notifications-trigger'));

        await waitFor(() => {
            expect(inboxServiceMocks.subscribeToNotificationInbox).toHaveBeenCalledWith(
                'user-1',
                expect.any(Function),
                expect.any(Function)
            );
        });
    });

    it('does not show an unread badge when there are no unread items', () => {
        // subscribeToNotificationInbox never calls back — items stay empty
        renderShell(true);
        expect(screen.queryByTestId('notification-unread-badge')).toBeNull();
    });

    it('shows the unread badge with the correct count when there are unread notifications', async () => {
        inboxServiceMocks.subscribeToUnreadNotificationCount.mockImplementation(
            (_uid: string, callback: (count: number) => void) => {
                callback(2);
                return vi.fn();
            }
        );

        renderShell(true);

        await waitFor(() => {
            const badge = screen.getByTestId('notification-unread-badge');
            expect(badge).toBeTruthy();
            expect(badge.textContent).toBe('2');
        });
    });

    it('opens the notification inbox sheet when the bell is clicked', async () => {
        renderShell(true);
        fireEvent.click(screen.getByTestId('app-shell-notifications-trigger'));
        await waitFor(() => {
            expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeTruthy();
        });
    });

    it('calls markNotificationRead when an inbox item is clicked', async () => {
        inboxServiceMocks.subscribeToNotificationInbox.mockImplementation(
            (_uid: string, callback: (items: Array<{ id: string; text: string; appRoute: string; readAt: unknown }>) => void) => {
                callback([
                    { id: 'notif-42', text: 'You were tagged', appRoute: '/home', readAt: null },
                ]);
                return vi.fn();
            }
        );

        renderShell(true);

        fireEvent.click(screen.getByTestId('app-shell-notifications-trigger'));
        await waitFor(() => screen.getByRole('dialog', { name: 'Notifications' }));

        fireEvent.click(screen.getByTestId('notification-item-notif-42'));

        await waitFor(() => {
            expect(inboxServiceMocks.markNotificationRead).toHaveBeenCalledWith('user-1', 'notif-42');
        });
    });

    it('closes the mobile inbox immediately when mark-read is delayed', async () => {
        inboxServiceMocks.subscribeToNotificationInbox.mockImplementation(
            (_uid: string, callback: (items: Array<{ id: string; text: string; appRoute: string; readAt: unknown }>) => void) => {
                callback([
                    { id: 'notif-slow', text: 'Game starting now', appRoute: '/games/game-1', readAt: null },
                ]);
                return vi.fn();
            }
        );
        inboxServiceMocks.markNotificationRead.mockImplementation(() => new Promise<void>(() => undefined));

        renderShell(false);

        fireEvent.click(screen.getByTestId('app-shell-notifications-trigger'));
        await waitFor(() => screen.getByRole('dialog', { name: 'Notifications' }));

        fireEvent.click(screen.getByTestId('notification-item-notif-slow'));

        expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull();
        await waitFor(() => {
            expect(inboxServiceMocks.markNotificationRead).toHaveBeenCalledWith('user-1', 'notif-slow');
        });
    });

    it('closes the mobile inbox immediately when mark-read rejects', async () => {
        inboxServiceMocks.subscribeToNotificationInbox.mockImplementation(
            (_uid: string, callback: (items: Array<{ id: string; text: string; appRoute: string; readAt: unknown }>) => void) => {
                callback([
                    { id: 'notif-fail', text: 'Schedule update', appRoute: '/schedule/game-2', readAt: null },
                ]);
                return vi.fn();
            }
        );
        inboxServiceMocks.markNotificationRead.mockRejectedValue(new Error('offline'));

        renderShell(false);

        fireEvent.click(screen.getByTestId('app-shell-notifications-trigger'));
        await waitFor(() => screen.getByRole('dialog', { name: 'Notifications' }));
        await waitFor(() => screen.getByTestId('notification-item-notif-fail'));

        fireEvent.click(screen.getByTestId('notification-item-notif-fail'));

        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull();
        });
        expect(inboxServiceMocks.markNotificationRead).toHaveBeenCalledWith('user-1', 'notif-fail');
    });

    it('closes the inbox sheet when close is triggered', async () => {
        renderShell(true);
        fireEvent.click(screen.getByTestId('app-shell-notifications-trigger'));
        await waitFor(() => screen.getByRole('dialog', { name: 'Notifications' }));

        fireEvent.click(screen.getByRole('button', { name: 'Close notifications' }));
        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull();
        });
    });

    it('caps the badge display at 99+ for very large unread counts', async () => {
        inboxServiceMocks.subscribeToUnreadNotificationCount.mockImplementation(
            (_uid: string, callback: (count: number) => void) => {
                callback(105);
                return vi.fn();
            }
        );

        renderShell(true);

        await waitFor(() => {
            const badge = screen.getByTestId('notification-unread-badge');
            expect(badge.textContent).toBe('99+');
        });
    });

    it('shows loading state before the first snapshot callback fires', async () => {
        // subscribeToNotificationInbox never calls back — inbox stays in loading state
        inboxServiceMocks.subscribeToNotificationInbox.mockReturnValue(vi.fn());

        renderShell(true);

        fireEvent.click(screen.getByTestId('app-shell-notifications-trigger'));

        await waitFor(() => {
            expect(screen.getByTestId('inbox-loading-state')).toBeTruthy();
        });
        expect(screen.queryByText('No notifications yet')).toBeNull();
    });

    it('shows error state when the onError callback is invoked before any items load', async () => {
        renderShell(true);

        fireEvent.click(screen.getByTestId('app-shell-notifications-trigger'));

        await waitFor(() => {
            expect(inboxServiceMocks.subscribeToNotificationInbox).toHaveBeenCalledWith(
                'user-1',
                expect.any(Function),
                expect.any(Function)
            );
        });

        const onError = inboxServiceMocks.subscribeToNotificationInbox.mock.calls[0]?.[2] as ((error: unknown) => void) | undefined;
        expect(onError).toBeTypeOf('function');

        act(() => {
            onError?.(new Error('Firestore unavailable'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('inbox-error-state')).toBeTruthy();
        });
        expect(screen.queryByText('No notifications yet')).toBeNull();
        expect(screen.queryByTestId('inbox-loading-state')).toBeNull();
    });

    it('keeps showing items after an error fires post-load', async () => {
        let capturedOnError: ((error: unknown) => void) | undefined;

        inboxServiceMocks.subscribeToNotificationInbox.mockImplementation(
            (
                _uid: string,
                callback: (items: Array<{ id: string; text: string; appRoute: string; readAt: unknown }>) => void,
                onError: (error: unknown) => void
            ) => {
                callback([{ id: 'n1', text: 'Game tonight', appRoute: '/schedule', readAt: null }]);
                capturedOnError = onError;
                return vi.fn();
            }
        );

        renderShell(true);

        // Open inbox and confirm items loaded
        fireEvent.click(screen.getByTestId('app-shell-notifications-trigger'));
        await waitFor(() => screen.getByTestId('notification-item-n1'));

        // Now trigger an error
        act(() => {
            capturedOnError?.(new Error('Lost connection'));
        });

        // Items still visible with error banner; no full error blank slate
        await waitFor(() => {
            expect(screen.getByTestId('notification-item-n1')).toBeTruthy();
            expect(screen.getByTestId('inbox-error-banner')).toBeTruthy();
        });
        expect(screen.queryByTestId('inbox-error-state')).toBeNull();
    });
});
