// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';
import type { NotificationInboxItem } from '../lib/notificationInboxService';
import type { AuthState } from '../lib/types';
import { APP_BACK_DISMISS_EVENT } from '../lib/nativeBackButton';

const publicActionMocks = vi.hoisted(() => ({
  openPublicUrl: vi.fn(() => Promise.resolve()),
}));

type SubscribeToNotificationInbox = (
  uid: string,
  onItems: (items: NotificationInboxItem[]) => void,
  onError?: (error: unknown) => void
) => () => void;

type SubscribeToUnreadNotificationCount = (
  uid: string,
  onCount: (count: number) => void,
  onError?: (error: unknown) => void
) => () => void;

const { useShellLayoutMock, subscribeToNotificationInboxMock, subscribeToUnreadNotificationCountMock, updateAppIconBadgeMock } = vi.hoisted(() => ({
  useShellLayoutMock: vi.fn(() => ({ isDesktopWeb: true })),
  subscribeToNotificationInboxMock: vi.fn<SubscribeToNotificationInbox>(() => vi.fn()),
  subscribeToUnreadNotificationCountMock: vi.fn<SubscribeToUnreadNotificationCount>(() => vi.fn()),
  updateAppIconBadgeMock: vi.fn(() => Promise.resolve()),
}));

vi.mock('../lib/useShellLayout', () => ({
  useShellLayout: useShellLayoutMock,
}));

vi.mock('../lib/uxTiming', () => ({
  recordUxTiming: vi.fn(),
}));

vi.mock('../lib/publicActions', () => publicActionMocks);

vi.mock('../lib/badgeService', () => ({
  updateAppIconBadge: updateAppIconBadgeMock,
}));

vi.mock('../lib/notificationInboxService', () => ({
  countUnread: (items: Array<{ readAt: unknown | null }>) => items.filter((item) => !item.readAt).length,
  markNotificationRead: vi.fn(),
  subscribeToNotificationInbox: subscribeToNotificationInboxMock,
  subscribeToUnreadNotificationCount: subscribeToUnreadNotificationCountMock,
}));

vi.mock('../lib/notificationInboxServiceLoader', () => ({
  loadNotificationInboxService: () => Promise.resolve({
    subscribeToNotificationInbox: subscribeToNotificationInboxMock,
    subscribeToUnreadNotificationCount: subscribeToUnreadNotificationCountMock,
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
  }),
}));

vi.mock('./AppSearchDialog', () => ({
  AppSearchDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Search teams, players, actions, and help" /> : null),
}));

vi.mock('./NotificationInboxSheet', () => ({
  NotificationInboxSheet: ({
    items,
    inboxState,
    onClose,
    onRetry,
  }: {
    items: Array<{ id: string; text: string }>;
    inboxState: 'loading' | 'ready' | 'error';
    onClose: () => void;
    onRetry?: () => void;
  }) => (
    <div role="dialog" aria-label="Notifications">
      <button type="button" aria-label="Close notifications" onClick={onClose}>Close</button>
      {onRetry ? <button type="button" onClick={onRetry}>Retry notifications</button> : null}
      <div data-testid="notification-inbox-sheet-state">{inboxState}</div>
      {items.map((item) => (
        <div key={item.id}>{item.text}</div>
      ))}
    </div>
  ),
}));

const auth: AuthState = {
  user: null,
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

const signedInAuth: AuthState = {
  ...auth,
  user: {
    uid: 'user-123',
    email: 'parent@example.com',
    displayName: 'Parent User',
    roles: ['parent'],
  },
};

describe('AppShell', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    useShellLayoutMock.mockReturnValue({ isDesktopWeb: true });
    subscribeToNotificationInboxMock.mockReset();
    subscribeToNotificationInboxMock.mockReturnValue(vi.fn());
    subscribeToUnreadNotificationCountMock.mockReset();
    subscribeToUnreadNotificationCountMock.mockReturnValue(vi.fn());
    updateAppIconBadgeMock.mockClear();
    publicActionMocks.openPublicUrl.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('adds an explicit accessible label to the desktop search button', () => {
    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<AppShell auth={auth}><div>Home</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    const searchButton = screen.getByRole('button', { name: 'Search' });
    expect(searchButton.getAttribute('aria-label')).toBe('Search');
    expect(searchButton.getAttribute('data-testid')).toBe('app-shell-search-trigger');
  });

  it('announces notification count changes through a live region', () => {
    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<AppShell auth={auth}><div>Home</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    const notificationStatus = screen.getByTestId('app-shell-notification-status');
    expect(notificationStatus.getAttribute('role')).toBe('status');
    expect(notificationStatus.getAttribute('aria-live')).toBe('polite');
    expect(notificationStatus.textContent).toBe('No unread notifications');
  });

  it('announces loading status until the signed-in inbox has loaded', () => {
    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<AppShell auth={signedInAuth}><div>Home</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('app-shell-notification-status').textContent).toBe('Loading notifications…');
  });

  it('announces load failures instead of a false empty inbox state', async () => {
    subscribeToUnreadNotificationCountMock.mockImplementation((_uid, _onCount, onError) => {
      onError?.(new Error('offline'));
      return vi.fn();
    });

    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<AppShell auth={signedInAuth}><div>Home</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('app-shell-notification-status').textContent).toBe('Could not load notifications');
    });
  });

  it('syncs the native app badge from unread notification counts', async () => {
    subscribeToUnreadNotificationCountMock.mockImplementation((_uid, onCount) => {
      onCount(3);
      return vi.fn();
    });

    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<AppShell auth={signedInAuth}><div>Home</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(updateAppIconBadgeMock).toHaveBeenCalledWith(3);
    });
  });

  it('does not clear the native app badge while auth is still bootstrapping', async () => {
    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<AppShell auth={{ ...auth, loading: true }}><div>Home</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(subscribeToUnreadNotificationCountMock).not.toHaveBeenCalled();
    });
    expect(updateAppIconBadgeMock).not.toHaveBeenCalled();
  });

  it('clears the native app badge after sign-out', async () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<AppShell auth={signedInAuth}><div>Home</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    rerender(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<AppShell auth={auth}><div>Home</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(updateAppIconBadgeMock).toHaveBeenLastCalledWith(0);
    });
  });

  it('does not subscribe to the full inbox until notifications are opened', async () => {
    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<AppShell auth={signedInAuth}><div>Home</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(subscribeToUnreadNotificationCountMock).toHaveBeenCalledWith(
        'user-123',
        expect.any(Function),
        expect.any(Function)
      );
    });
    expect(subscribeToNotificationInboxMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('app-shell-notifications-trigger'));

    await waitFor(() => {
      expect(subscribeToNotificationInboxMock).toHaveBeenCalledWith(
        'user-123',
        expect.any(Function),
        expect.any(Function)
      );
    });
  });

  it('retries the open notification inbox subscription without closing the sheet', async () => {
    const firstUnsubscribe = vi.fn();
    const secondUnsubscribe = vi.fn();
    subscribeToNotificationInboxMock
      .mockReturnValueOnce(firstUnsubscribe)
      .mockReturnValueOnce(secondUnsubscribe);

    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<AppShell auth={signedInAuth}><div>Home</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId('app-shell-notifications-trigger'));

    await waitFor(() => {
      expect(subscribeToNotificationInboxMock).toHaveBeenCalledTimes(1);
    });

    const onError = subscribeToNotificationInboxMock.mock.calls[0]?.[2] as ((error: unknown) => void) | undefined;
    act(() => {
      onError?.(new Error('offline'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('notification-inbox-sheet-state').textContent).toBe('error');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry notifications' }));

    await waitFor(() => {
      expect(subscribeToNotificationInboxMock).toHaveBeenCalledTimes(2);
    });
    expect(firstUnsubscribe).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeTruthy();
    expect(screen.getByTestId('notification-inbox-sheet-state').textContent).toBe('loading');

    const onRetryItems = subscribeToNotificationInboxMock.mock.calls[1]?.[1] as ((items: NotificationInboxItem[]) => void) | undefined;
    act(() => {
      onRetryItems?.([]);
    });

    await waitFor(() => {
      expect(screen.getByTestId('notification-inbox-sheet-state').textContent).toBe('ready');
    });
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeTruthy();
  });

  it('clears cached inbox items when the signed-in uid changes while the sheet is closed', async () => {
    subscribeToNotificationInboxMock.mockImplementation((uid, onItems) => {
      onItems([
        {
          id: `notif-${uid}`,
          category: 'team_message',
          type: 'team_message',
          title: 'Notification',
          body: '',
          text: `Notification for ${uid}`,
          appRoute: '/messages',
          conversationId: '',
          createdAt: null,
          readAt: null,
        },
      ]);
      return vi.fn();
    });

    const { rerender } = render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<AppShell auth={signedInAuth}><div>Home</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId('app-shell-notifications-trigger'));
    await waitFor(() => {
      expect(screen.getByText('Notification for user-123')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Close notifications' }));

    rerender(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route
            path="/home"
            element={<AppShell auth={{ ...signedInAuth, user: { ...signedInAuth.user!, uid: 'user-456' } }}><div>Home</div></AppShell>}
          />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId('app-shell-notifications-trigger'));

    await waitFor(() => {
      expect(screen.getByTestId('notification-inbox-sheet-state').textContent).toBe('loading');
    });
    expect(screen.queryByText('Notification for user-123')).toBeNull();
  });

  it('keeps the mobile search trigger discoverable with a stable selector', () => {
    useShellLayoutMock.mockReturnValue({ isDesktopWeb: false });

    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<AppShell auth={auth}><div>Home</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    const searchButton = screen.getByTestId('app-shell-search-trigger');
    expect(searchButton.getAttribute('aria-label')).toBe('Search');
  });

  it('opens the search dialog immediately when the desktop search button is clicked', async () => {
    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<AppShell auth={auth}><div>Home</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Search teams, players, actions, and help' })).toBeTruthy());
  });

  it('opens the search dialog from the Ctrl+K shortcut before browser chrome can consume it', async () => {
    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<AppShell auth={auth}><div>Home</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    const event = new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Search teams, players, actions, and help' })).toBeTruthy());
  });

  it('routes Fees through the native team picker instead of the public website handoff', async () => {
    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<AppShell auth={signedInAuth}><div>Home</div></AppShell>} />
          <Route path="/teams" element={<AppShell auth={signedInAuth}><div>Teams hub</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('button', { name: /FeesSelect a team for fee setup, checkout, and balancesCoach\/Admin/i }));

    await waitFor(() => {
      expect(screen.getByText('Teams hub')).toBeTruthy();
    });
    expect(publicActionMocks.openPublicUrl).not.toHaveBeenCalled();
  });

  it('dismisses the search dialog when native back asks overlays to close', async () => {
    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<AppShell auth={auth}><div>Home</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Search teams, players, actions, and help' })).toBeTruthy());

    const event = new Event(APP_BACK_DISMISS_EVENT, { cancelable: true });
    act(() => {
      window.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(screen.queryByRole('dialog', { name: 'Search teams, players, actions, and help' })).toBeNull();
  });
});
