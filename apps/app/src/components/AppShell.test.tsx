// @vitest-environment jsdom
import { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';
import type { NotificationInboxItem } from '../lib/notificationInboxService';
import type { AuthState } from '../lib/types';
import { APP_BACK_DISMISS_EVENT } from '../lib/nativeBackButton';
import { useScheduleAccessReporter } from './ScheduleAccessReporting';

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

const notificationSheetSuspension = vi.hoisted(() => {
  let pending: Promise<void> | null = null;
  let release: (() => void) | null = null;

  return {
    suspend() {
      pending = new Promise<void>((resolve) => {
        release = () => {
          pending = null;
          resolve();
        };
      });
    },
    current() {
      return pending;
    },
    resolve() {
      release?.();
      release = null;
    },
  };
});

vi.mock('../lib/useShellLayout', () => ({
  useShellLayout: useShellLayoutMock,
}));

const recordUxTimingMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/uxTiming', () => ({
  recordUxTiming: recordUxTimingMock,
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
  }) => {
    const pending = notificationSheetSuspension.current();
    if (pending) throw pending;

    return (
      <div role="dialog" aria-label="Notifications">
        <button type="button" aria-label="Close notifications" onClick={onClose}>Close</button>
        {onRetry ? <button type="button" onClick={onRetry}>Retry notifications</button> : null}
        <div data-testid="notification-inbox-sheet-state">{inboxState}</div>
        {items.map((item) => (
          <div key={item.id}>{item.text}</div>
        ))}
      </div>
    );
  },
}));

function ReportDiscoveredScheduleAccess({
  hasFamily = false,
  hasStaff = true
}: {
  hasFamily?: boolean;
  hasStaff?: boolean;
} = {}) {
  const reportAccess = useScheduleAccessReporter();
  useEffect(() => {
    reportAccess({
      userId: 'user-123',
      hasFamily,
      hasStaff
    });
  }, [hasFamily, hasStaff, reportAccess]);
  return <div>Schedule content</div>;
}

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

function setDocumentVisibility(visibilityState: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: visibilityState,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="current-route">{location.pathname}{location.search}</div>;
}

describe('AppShell', () => {
  it('updates desktop schedule navigation for an authoritatively discovered email-only team admin', async () => {
    const emailOnlyAdminAuth = {
      ...signedInAuth,
      roles: [],
      isParent: false,
      isCoach: false,
      isAdmin: false,
      user: signedInAuth.user ? {
        ...signedInAuth.user,
        roles: [],
        parentTeamIds: [],
        parentPlayerKeys: [],
        parentOf: [],
        coachOf: []
      } : null
    };

    render(
      <MemoryRouter initialEntries={['/schedule']}>
        <Routes>
          <Route
            path="/schedule"
            element={(
              <AppShell auth={emailOnlyAdminAuth}>
                <ReportDiscoveredScheduleAccess />
              </AppShell>
            )}
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Team schedule')).toBeTruthy();
      expect(screen.getByText('Manage with AI')).toBeTruthy();
    });
    expect(screen.queryByText('Family schedule')).toBeNull();
  });

  it('keeps Family in desktop navigation for an authoritatively discovered email-only parent', async () => {
    const emailOnlyParentAuth = {
      ...signedInAuth,
      roles: [],
      isParent: false,
      user: signedInAuth.user ? {
        ...signedInAuth.user,
        roles: [],
        parentTeamIds: [],
        parentPlayerKeys: [],
        parentOf: [],
        coachOf: []
      } : null
    };

    render(
      <MemoryRouter initialEntries={['/schedule']}>
        <AppShell auth={emailOnlyParentAuth}>
          <Routes>
            <Route
              path="/schedule"
              element={<ReportDiscoveredScheduleAccess hasFamily hasStaff={false} />}
            />
            <Route path="/parent-tools" element={<div>Family tools</div>} />
          </Routes>
        </AppShell>
      </MemoryRouter>
    );

    const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' });
    const familyLink = await within(primaryNav).findByRole('link', { name: 'Family' });
    fireEvent.click(familyLink);

    expect(await screen.findByText('Family tools')).toBeTruthy();
    expect(within(primaryNav).getByRole('link', { name: 'Family' })).toBeTruthy();
  });

  it('keeps Family in mobile More for an authoritatively discovered email-only parent', async () => {
    useShellLayoutMock.mockReturnValue({ isDesktopWeb: false });
    const emailOnlyParentAuth = {
      ...signedInAuth,
      roles: [],
      isParent: false,
      user: signedInAuth.user ? {
        ...signedInAuth.user,
        roles: [],
        parentTeamIds: [],
        parentPlayerKeys: [],
        parentOf: [],
        coachOf: []
      } : null
    };

    render(
      <MemoryRouter initialEntries={['/schedule']}>
        <AppShell auth={emailOnlyParentAuth}>
          <ReportDiscoveredScheduleAccess hasFamily hasStaff={false} />
        </AppShell>
      </MemoryRouter>
    );

    const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' });
    fireEvent.click(within(primaryNav).getByRole('button', { name: 'More' }));
    const moreNav = within(screen.getByRole('dialog', { name: 'More from ALL PLAYS' }))
      .getByRole('navigation', { name: 'More navigation' });
    expect((await within(moreNav).findByRole('link', { name: /Family/ })).getAttribute('href')).toBe('/parent-tools');
  });

  beforeEach(() => {
    notificationSheetSuspension.resolve();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
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
    Reflect.deleteProperty(document, 'visibilityState');
  });

  it('measures route paint from navigation, not from the previous route paint', () => {
    // Regression: the baseline was only reset after the previous route's
    // paint, so dwell time on that route inflated every route paint metric.
    let nowValue = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => nowValue);
    recordUxTimingMock.mockClear();

    render(
      <MemoryRouter initialEntries={['/home']}>
        <AppShell auth={auth}>
          <Routes>
            <Route path="/home" element={<Link to="/schedule">Go schedule</Link>} />
            <Route path="/schedule" element={<div>Schedule</div>} />
          </Routes>
        </AppShell>
      </MemoryRouter>
    );

    expect(recordUxTimingMock).toHaveBeenCalledWith('route paint', 1000, { route: '/home' });

    // Dwell on /home for a minute, then navigate.
    nowValue = 61000;
    fireEvent.click(screen.getByText('Go schedule'));

    const schedulePaint = recordUxTimingMock.mock.calls.find((call) => call[2]?.route === '/schedule');
    expect(schedulePaint?.[1]).toBe(61000);
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

  it('adds Family to signed-in desktop navigation and marks nested tools active', () => {
    render(
      <MemoryRouter initialEntries={['/parent-tools/fees']}>
        <Routes>
          <Route path="/parent-tools/fees" element={<AppShell auth={signedInAuth}><div>Family fees</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' });
    const familyLink = within(primaryNav).getByRole('link', { name: 'Family' });
    expect(familyLink.getAttribute('href')).toBe('/parent-tools');
    expect(familyLink.className).toContain('bg-primary-50');
  });

  it('routes the desktop My Teams nav directly to the team page when the user has one team', async () => {
    const oneTeamAuth: AuthState = {
      ...signedInAuth,
      user: signedInAuth.user ? { ...signedInAuth.user, parentTeamIds: ['team-1'] } : null,
    };

    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<AppShell auth={oneTeamAuth}><div>Home</div></AppShell>} />
          <Route path="/teams/:teamId" element={<AppShell auth={oneTeamAuth}><div>Team detail</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' });
    const teamsLink = within(primaryNav).getByRole('link', { name: 'My Teams' });
    expect(teamsLink.getAttribute('href')).toBe('/teams/team-1');

    fireEvent.click(teamsLink);

    await waitFor(() => {
      expect(screen.getByText('Team detail')).toBeTruthy();
    });
  });

  it('keeps the desktop My Teams nav on the team picker when the user has multiple teams', () => {
    const twoTeamAuth: AuthState = {
      ...signedInAuth,
      user: signedInAuth.user ? { ...signedInAuth.user, parentTeamIds: ['team-1', 'team-2'] } : null,
    };

    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<AppShell auth={twoTeamAuth}><div>Home</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(within(primaryNav).getByRole('link', { name: 'My Teams' }).getAttribute('href')).toBe('/teams');
  });

  it('signs out from the desktop account card', async () => {
    const signOut = vi.fn().mockResolvedValue(undefined);

    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<AppShell auth={{ ...signedInAuth, signOut }}><LocationDisplay /></AppShell>} />
          <Route path="/auth" element={<div>Auth</div>} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => {
      expect(signOut).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText('Auth')).toBeTruthy();
  });

  it('keeps signed-in mobile navigation to five items and exposes lower-frequency destinations in More', () => {
    useShellLayoutMock.mockReturnValue({ isDesktopWeb: false });
    render(
      <MemoryRouter initialEntries={['/parent-tools/fees']}>
        <Routes>
          <Route path="/parent-tools/fees" element={<AppShell auth={signedInAuth}><div>Family fees</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(within(primaryNav).getAllByRole('link')).toHaveLength(4);
    expect(within(primaryNav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Home', 'Schedule', 'Messages', 'My Teams']);
    expect(within(primaryNav).queryByRole('link', { name: 'Family' })).toBeNull();
    const moreButton = within(primaryNav).getByRole('button', { name: 'More' });
    expect(moreButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(moreButton);

    const moreDialog = screen.getByRole('dialog', { name: 'More from ALL PLAYS' });
    const moreNav = within(moreDialog).getByRole('navigation', { name: 'More navigation' });
    expect(within(moreNav).getByRole('link', { name: /Profile/ })).toHaveAttribute('href', '/profile');
    expect(within(moreNav).getByRole('link', { name: /Family/ })).toHaveAttribute('href', '/parent-tools');
    expect(within(moreNav).getByRole('link', { name: /Discover/ })).toHaveAttribute('href', '/discover');
  });

  it('keeps Schedule scoped to the team currently open in My Teams', () => {
    useShellLayoutMock.mockReturnValue({ isDesktopWeb: false });
    render(
      <MemoryRouter initialEntries={['/teams/team-vipers']}>
        <Routes>
          <Route path="/teams/:teamId" element={<AppShell auth={signedInAuth}><div>Vipers</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(within(primaryNav).getByRole('link', { name: 'Schedule' })).toHaveAttribute(
      'href',
      '/schedule?teamId=team-vipers'
    );
  });

  it('keeps Schedule scoped across nested team management pages', () => {
    useShellLayoutMock.mockReturnValue({ isDesktopWeb: false });
    render(
      <MemoryRouter initialEntries={['/teams/team-vipers/settings']}>
        <Routes>
          <Route path="/teams/:teamId/settings" element={<AppShell auth={signedInAuth}><div>Vipers settings</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(within(primaryNav).getByRole('link', { name: 'Schedule' })).toHaveAttribute(
      'href',
      '/schedule?teamId=team-vipers'
    );
  });

  it('routes the mobile My Teams nav directly to the team page when the user has one team', () => {
    useShellLayoutMock.mockReturnValue({ isDesktopWeb: false });
    const oneTeamAuth: AuthState = {
      ...signedInAuth,
      user: signedInAuth.user ? {
        ...signedInAuth.user,
        parentOf: [{ teamId: 'team-1', playerId: 'player-1' }],
      } : null,
    };

    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<AppShell auth={oneTeamAuth}><div>Home</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(within(primaryNav).getByRole('link', { name: 'My Teams' }).getAttribute('href')).toBe('/teams/team-1');
  });

  it('marks More current for a nested destination and dismisses it with native back', () => {
    useShellLayoutMock.mockReturnValue({ isDesktopWeb: false });
    render(
      <MemoryRouter initialEntries={['/parent-tools/fees']}>
        <Routes>
          <Route path="/parent-tools/fees" element={<AppShell auth={signedInAuth}><div>Family fees</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' });
    const moreButton = within(primaryNav).getByRole('button', { name: 'More' });
    expect(moreButton).toHaveAttribute('aria-current', 'page');

    fireEvent.click(moreButton);
    expect(screen.getByRole('dialog', { name: 'More from ALL PLAYS' })).toBeTruthy();
    fireEvent(window, new CustomEvent(APP_BACK_DISMISS_EVENT));
    expect(screen.queryByRole('dialog', { name: 'More from ALL PLAYS' })).toBeNull();
  });

  it('does not add Family to signed-out navigation', () => {
    render(
      <MemoryRouter initialEntries={['/discover']}>
        <Routes>
          <Route path="/discover" element={<AppShell auth={{ ...auth, roles: [] }}><div>Discover</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.queryByRole('link', { name: 'Family' })).toBeNull();
  });

  it('labels the signed-out brand as public exploration instead of an account preview', () => {
    render(
      <MemoryRouter initialEntries={['/discover']}>
        <Routes>
          <Route path="/discover" element={<AppShell auth={{ ...auth, roles: [] }}><div>Discover</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Explore ALL PLAYS')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go to Discover' })).toBeTruthy();
    expect(screen.queryByText('Signed out preview')).toBeNull();
  });

  it('labels a roleless signed-in session as signed in instead of public exploration', () => {
    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route
            path="/home"
            element={(
              <AppShell auth={{
                ...signedInAuth,
                roles: [],
                user: signedInAuth.user ? { ...signedInAuth.user, roles: [] } : null,
              }}>
                <div>Home</div>
              </AppShell>
            )}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Signed in')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go to home' })).toBeTruthy();
    expect(screen.queryByText('Explore ALL PLAYS')).toBeNull();
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

  it('shows and dismisses notification loading feedback while the lazy sheet is suspended', async () => {
    useShellLayoutMock.mockReturnValue({ isDesktopWeb: false });
    notificationSheetSuspension.suspend();

    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<AppShell auth={signedInAuth}><div>Home</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId('app-shell-notifications-trigger'));

    expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Loading notifications' })).toBeTruthy();

    await waitFor(() => {
      expect(subscribeToNotificationInboxMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Close notifications' }));
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull();

    act(() => notificationSheetSuspension.resolve());
    await act(async () => Promise.resolve());
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull();

    notificationSheetSuspension.suspend();
    fireEvent.click(screen.getByTestId('app-shell-notifications-trigger'));
    expect(screen.getByRole('status', { name: 'Loading notifications' })).toBeTruthy();

    await waitFor(() => {
      expect(subscribeToNotificationInboxMock).toHaveBeenCalledTimes(2);
    });

    act(() => notificationSheetSuspension.resolve());

    await waitFor(() => {
      expect(screen.getByTestId('notification-inbox-sheet-state').textContent).toBe('loading');
    });
    expect(subscribeToNotificationInboxMock).toHaveBeenCalledTimes(2);
  });

  it('announces load failures without hydrating the full inbox behind the badge', async () => {
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

  it('renders 99+ and syncs the bounded native badge count when the unread cap is reached', async () => {
    subscribeToUnreadNotificationCountMock.mockImplementation((_uid, onCount) => {
      onCount(100);
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
      expect(screen.getByTestId('notification-unread-badge').textContent).toBe('99+');
      expect(updateAppIconBadgeMock).toHaveBeenCalledWith(100);
    });
    expect(subscribeToNotificationInboxMock).not.toHaveBeenCalled();
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

  it('pauses the unread listener while backgrounded with the inbox closed', async () => {
    const firstUnsubscribe = vi.fn();
    const secondUnsubscribe = vi.fn();
    subscribeToUnreadNotificationCountMock
      .mockReturnValueOnce(firstUnsubscribe)
      .mockReturnValueOnce(secondUnsubscribe);

    const { unmount } = render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<AppShell auth={signedInAuth}><div>Home</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(subscribeToUnreadNotificationCountMock).toHaveBeenCalledTimes(1));
    act(() => setDocumentVisibility('hidden'));
    expect(firstUnsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribeToNotificationInboxMock).not.toHaveBeenCalled();

    act(() => setDocumentVisibility('visible'));
    await waitFor(() => expect(subscribeToUnreadNotificationCountMock).toHaveBeenCalledTimes(2));
    expect(subscribeToNotificationInboxMock).not.toHaveBeenCalled();

    act(() => setDocumentVisibility('hidden'));
    expect(secondUnsubscribe).toHaveBeenCalledTimes(1);
    unmount();
    expect(secondUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('pauses and replaces open-inbox listeners without clearing cached UI', async () => {
    const unreadUnsubscribes = [vi.fn(), vi.fn()];
    const inboxUnsubscribes = [vi.fn(), vi.fn()];
    subscribeToUnreadNotificationCountMock
      .mockImplementationOnce((_uid, onCount) => {
        onCount(7);
        return unreadUnsubscribes[0]!;
      })
      .mockImplementationOnce((_uid, onCount) => {
        onCount(8);
        return unreadUnsubscribes[1]!;
      });
    subscribeToNotificationInboxMock
      .mockImplementationOnce((_uid, onItems) => {
        onItems([{
          id: 'cached-notification',
          category: 'team_message',
          type: 'team_message',
          title: 'Team update',
          body: '',
          text: 'Cached while backgrounded',
          appRoute: '/messages',
          conversationId: '',
          createdAt: null,
          readAt: null,
        }]);
        return inboxUnsubscribes[0]!;
      })
      .mockImplementationOnce((_uid, onItems) => {
        onItems([{
          id: 'resumed-notification',
          category: 'team_message',
          type: 'team_message',
          title: 'New team update',
          body: '',
          text: 'Refreshed after resume',
          appRoute: '/messages',
          conversationId: '',
          createdAt: null,
          readAt: null,
        }]);
        return inboxUnsubscribes[1]!;
      });

    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<AppShell auth={signedInAuth}><div>Home</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId('app-shell-notifications-trigger'));
    await waitFor(() => {
      expect(screen.getByText('Cached while backgrounded')).toBeTruthy();
      expect(screen.getByTestId('notification-unread-badge').textContent).toBe('7');
    });

    act(() => setDocumentVisibility('hidden'));
    expect(unreadUnsubscribes[0]).toHaveBeenCalledTimes(1);
    expect(inboxUnsubscribes[0]).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Cached while backgrounded')).toBeTruthy();
    expect(screen.getByTestId('notification-unread-badge').textContent).toBe('7');

    act(() => setDocumentVisibility('hidden'));
    expect(unreadUnsubscribes[0]).toHaveBeenCalledTimes(1);
    expect(inboxUnsubscribes[0]).toHaveBeenCalledTimes(1);

    act(() => setDocumentVisibility('visible'));
    await waitFor(() => {
      expect(subscribeToUnreadNotificationCountMock).toHaveBeenCalledTimes(2);
      expect(subscribeToNotificationInboxMock).toHaveBeenCalledTimes(2);
      expect(screen.getByText('Refreshed after resume')).toBeTruthy();
      expect(screen.getByTestId('notification-unread-badge').textContent).toBe('8');
      expect(updateAppIconBadgeMock).toHaveBeenCalledWith(8);
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

    const onItems = subscribeToNotificationInboxMock.mock.calls[0]?.[1] as ((items: NotificationInboxItem[]) => void) | undefined;
    act(() => {
      onItems?.([
        {
          id: 'cached-notification',
          category: 'team_message',
          type: 'team_message',
          title: 'Team update',
          body: '',
          text: 'Cached notification',
          appRoute: '/messages',
          conversationId: '',
          createdAt: null,
          readAt: null,
        },
      ]);
    });

    await waitFor(() => {
      expect(screen.getByTestId('notification-inbox-sheet-state').textContent).toBe('ready');
    });
    expect(screen.getByText('Cached notification')).toBeTruthy();

    const onError = subscribeToNotificationInboxMock.mock.calls[0]?.[2] as ((error: unknown) => void) | undefined;
    act(() => {
      onError?.(new Error('offline'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('notification-inbox-sheet-state').textContent).toBe('error');
    });
    expect(screen.getByText('Cached notification')).toBeTruthy();

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

  it('opens search from a mobile message thread without leaving the thread', async () => {
    useShellLayoutMock.mockReturnValue({ isDesktopWeb: false });

    render(
      <MemoryRouter initialEntries={['/messages/team-1']}>
        <Routes>
          <Route
            path="/messages/:conversationId"
            element={<AppShell auth={auth}><div>Thread<LocationDisplay /></div></AppShell>}
          />
        </Routes>
      </MemoryRouter>
    );

    const searchButton = screen.getByTestId('app-shell-search-trigger');
    expect(searchButton.getAttribute('aria-label')).toBe('Search');
    expect(screen.getByTestId('current-route').textContent).toBe('/messages/team-1');

    fireEvent.click(searchButton);
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Search teams, players, actions, and help' })).toBeTruthy());
    expect(screen.getByTestId('current-route').textContent).toBe('/messages/team-1');
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

  it.each([
    { isDesktopWeb: true, layout: 'desktop web' },
    { isDesktopWeb: false, layout: 'mobile/native' },
  ])('shows the same common-first Add workflow state on $layout', ({ isDesktopWeb }) => {
    useShellLayoutMock.mockReturnValue({ isDesktopWeb });

    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<AppShell auth={signedInAuth}><div>Home</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    const dialog = screen.getByRole('dialog', { name: 'Add workflow' });
    expect(dialog.querySelectorAll('.add-workflow-card')).toHaveLength(3);
    expect(within(dialog).getByRole('button', { name: /^Join with code/ })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /^Find team/ })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /^Create team/ })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: /^Game or practice/ })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: /^Fees/ })).toBeNull();

    const disclosure = within(dialog).getByRole('button', { name: /^More workflows/ });
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(disclosure);

    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    expect(dialog.querySelectorAll('.add-workflow-card')).toHaveLength(17);
    expect(within(dialog).getByRole('button', { name: /^Game or practice/ })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /^Fees/ })).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: /^More workflows/ }));
    fireEvent.click(screen.getByRole('button', { name: /FeesSelect a team for fee setup, checkout, and balancesCoach\/Admin/i }));

    await waitFor(() => {
      expect(screen.getByText('Teams hub')).toBeTruthy();
    });
    expect(publicActionMocks.openPublicUrl).not.toHaveBeenCalled();
  });

  it.each([
    {
      actionName: /Add playerRoster, parent invite, fields, importCoach\/Admin/i,
      expectedRoute: '/teams?workflow=roster',
      routePath: '/teams'
    },
    {
      actionName: /Game or practiceSchedule, reminders, officials, recurringCoach\/Admin/i,
      expectedRoute: '/schedule?scope=staff&staffTools=1&staffSection=add',
      routePath: '/schedule'
    }
  ])('opens $expectedRoute from the native Add workflow', async ({ actionName, expectedRoute, routePath }) => {
    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<AppShell auth={signedInAuth}><div>Home</div></AppShell>} />
          <Route path={routePath} element={<AppShell auth={signedInAuth}><LocationDisplay /></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('button', { name: /^More workflows/ }));
    fireEvent.click(screen.getByRole('button', { name: actionName }));

    await waitFor(() => {
      expect(screen.getByTestId('current-route')).toHaveTextContent(expectedRoute);
    });
    expect(publicActionMocks.openPublicUrl).not.toHaveBeenCalled();
  });

  it('routes Create team through the native app flow', async () => {
    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<AppShell auth={signedInAuth}><div>Home</div></AppShell>} />
          <Route path="/teams/new" element={<AppShell auth={signedInAuth}><div>Native create team</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('button', { name: /^Create team/ }));

    await waitFor(() => {
      expect(screen.getByText('Native create team')).toBeTruthy();
    });
    expect(publicActionMocks.openPublicUrl).not.toHaveBeenCalled();
  });

  it.each([
    ['desktop web', true],
    ['mobile', false],
  ])('routes Find team to native public-team browse on %s', async (_layout, isDesktopWeb) => {
    useShellLayoutMock.mockReturnValue({ isDesktopWeb });
    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<AppShell auth={signedInAuth}><div>Home</div></AppShell>} />
          <Route path="/teams/browse" element={<AppShell auth={signedInAuth}><div>Native public team browse</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    const findTeam = screen.getByRole('button', { name: /Find team.*Browse and search public teams.*App/i });
    expect(findTeam).toBeTruthy();
    fireEvent.click(findTeam);

    await waitFor(() => {
      expect(screen.getByText('Native public team browse')).toBeTruthy();
    });
    expect(publicActionMocks.openPublicUrl).not.toHaveBeenCalled();
  });

  it('routes signed-out preview users to the native public team finder', async () => {
    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<AppShell auth={auth}><div>Home</div></AppShell>} />
          <Route path="/teams/browse" element={<AppShell auth={auth}><div>Native public team browse</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('button', { name: /Find team.*Browse and search public teams.*App/i }));

    await waitFor(() => {
      expect(screen.getByText('Native public team browse')).toBeTruthy();
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
