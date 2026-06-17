// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../../apps/app/src/components/AppShell';
import type { AuthState } from '../../apps/app/src/lib/types';

// --- Hoisted mocks ---

const { useShellLayoutMock } = vi.hoisted(() => ({
    useShellLayoutMock: vi.fn(() => ({ isDesktopWeb: true })),
}));

const inboxServiceMocks = vi.hoisted(() => ({
    subscribeToNotificationInbox: vi.fn(() => vi.fn()),
    countUnread: vi.fn((items: Array<{ readAt: unknown }>) => items.filter((i) => !i.readAt).length),
    markNotificationRead: vi.fn(() => Promise.resolve()),
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

vi.mock('../../apps/app/src/lib/notificationInboxService', () => inboxServiceMocks);

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
                                    onClick={() => void onMarkRead(uid, item.id).then(onClose)}
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

function renderShell(isDesktop = true) {
    useShellLayoutMock.mockReturnValue({ isDesktopWeb: isDesktop });
    return render(
        <MemoryRouter initialEntries={['/home']}>
            <Routes>
                <Route
                    path="/home"
                    element={
                        <AppShell auth={auth}>
                            <div>Home content</div>
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
        inboxServiceMocks.markNotificationRead.mockResolvedValue(undefined);
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

    it('subscribes to the notification inbox for the signed-in user', () => {
        renderShell(true);
        expect(inboxServiceMocks.subscribeToNotificationInbox).toHaveBeenCalledWith(
            'user-1',
            expect.any(Function),
            expect.any(Function)
        );
    });

    it('does not show an unread badge when there are no unread items', () => {
        // subscribeToNotificationInbox never calls back — items stay empty
        renderShell(true);
        expect(screen.queryByTestId('notification-unread-badge')).toBeNull();
    });

    it('shows the unread badge with the correct count when there are unread notifications', async () => {
        inboxServiceMocks.subscribeToNotificationInbox.mockImplementation(
            (_uid: string, callback: (items: Array<{ id: string; text: string; appRoute: string; readAt: unknown }>) => void) => {
                callback([
                    { id: 'n1', text: 'Game tonight', appRoute: '/schedule', readAt: null },
                    { id: 'n2', text: 'Practice update', appRoute: '/schedule', readAt: 'some-ts' },
                    { id: 'n3', text: 'New message', appRoute: '/messages', readAt: null },
                ]);
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

        // Open the inbox
        fireEvent.click(screen.getByTestId('app-shell-notifications-trigger'));
        await waitFor(() => screen.getByRole('dialog', { name: 'Notifications' }));

        // Click the notification item
        fireEvent.click(screen.getByTestId('notification-item-notif-42'));

        await waitFor(() => {
            expect(inboxServiceMocks.markNotificationRead).toHaveBeenCalledWith('user-1', 'notif-42');
        });
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
        const manyItems = Array.from({ length: 105 }, (_, i) => ({
            id: `n${i}`,
            text: `Notification ${i}`,
            appRoute: '/home',
            readAt: null,
        }));

        inboxServiceMocks.subscribeToNotificationInbox.mockImplementation(
            (_uid: string, callback: (items: typeof manyItems) => void) => {
                callback(manyItems);
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
        let capturedOnError: ((error: unknown) => void) | undefined;

        inboxServiceMocks.subscribeToNotificationInbox.mockImplementation(
            (_uid: string, _callback: unknown, onError: (error: unknown) => void) => {
                capturedOnError = onError;
                return vi.fn();
            }
        );

        renderShell(true);

        // Trigger the error callback before any items arrive
        act(() => {
            capturedOnError?.(new Error('Firestore unavailable'));
        });

        fireEvent.click(screen.getByTestId('app-shell-notifications-trigger'));

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
