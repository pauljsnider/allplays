// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { writeAuthBootstrapHint } from './lib/authBootstrapHint';
import type { AuthState } from './lib/types';

const suspendedHomePromise = new Promise<never>(() => {});
let homeRenderMode: 'suspend' | 'throw' = 'suspend';
let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;
const authMock = vi.hoisted(() => {
  const signedInAuth: AuthState = {
    user: { uid: 'user-1', email: 'parent@example.com', displayName: 'Pat Parent', roles: ['parent'] },
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
  return {
    signedInAuth,
    state: signedInAuth as AuthState
  };
});
const nativeBackMock = vi.hoisted(() => {
  const state = {
    listeners: [] as Array<(event: { canGoBack: boolean }) => void>,
    urlOpenListeners: [] as Array<(event: { url: string }) => void>,
    exitApp: vi.fn(),
    remove: vi.fn()
  };
  return {
    ...state,
    addListener: vi.fn(async (eventName: 'appUrlOpen' | 'backButton', listener: ((event: { canGoBack: boolean }) => void) | ((event: { url: string }) => void)) => {
      if (eventName === 'appUrlOpen') {
        state.urlOpenListeners.push(listener as (event: { url: string }) => void);
      } else {
        state.listeners.push(listener as (event: { canGoBack: boolean }) => void);
      }
      return { remove: state.remove };
    })
  };
});
const capacitorMock = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => true),
  isPluginAvailable: vi.fn(() => true),
  getPlatform: vi.fn(() => 'ios')
}));
const pushRoutingMock = vi.hoisted(() => ({
  clearPendingPushRoute: vi.fn(),
  readPendingPushRoute: vi.fn<() => string | null>(() => null)
}));
const pushServiceMock = vi.hoisted(() => {
  const state = {
    lastListener: null as ((route: string) => void) | null
  };
  return {
    ...state,
    addPushNotificationOpenListener: vi.fn(async (listener: (route: string) => void) => {
      state.lastListener = listener;
      return () => {};
    }),
    ensureAndroidNotificationChannels: vi.fn(async () => {})
  };
});

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: nativeBackMock.addListener,
    exitApp: nativeBackMock.exitApp
  }
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: capacitorMock
}));

vi.mock('./lib/useAuth', () => ({
  useAuth: () => authMock.state,
}));

vi.mock('./components/AppShell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => (
    <div>
      <nav aria-label="Primary navigation">Shell navigation</nav>
      <div>{children}</div>
    </div>
  ),
}));

vi.mock('./lib/pushNotificationRouting', () => pushRoutingMock);

vi.mock('./lib/reloadRouting', () => ({
  shouldReloadTeamsToHome: vi.fn(() => false),
}));

vi.mock('./lib/pushService', () => pushServiceMock);

vi.mock('./pages/Home', () => ({
  Home: () => {
    if (homeRenderMode === 'throw') {
      throw new Error('Home page render failed');
    }
    throw suspendedHomePromise;
  },
}));

vi.mock('./pages/PublicTeamsBrowse', () => ({
  PublicTeamsBrowse: () => <div>Browse public teams page</div>,
}));

vi.mock('./pages/Officials', () => ({
  Officials: () => <div>Officials assignments page</div>,
}));

vi.mock('./pages/Schedule', () => ({
  Schedule: () => <div>Schedule page</div>,
}));

vi.mock('./pages/ScheduleEventDetail', () => ({
  ScheduleEventDetail: () => <div>Event detail page</div>,
}));

vi.mock('./pages/Messages', () => ({
  Messages: () => <div>Messages page</div>,
}));

function installTestLocalStorage() {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => store.get(key) || null),
      setItem: vi.fn((key: string, value: string) => {
        store.set(key, String(value));
      }),
      removeItem: vi.fn((key: string) => {
        store.delete(key);
      }),
      clear: vi.fn(() => {
        store.clear();
      })
    }
  });
}

describe('App protected route loading', () => {
  beforeEach(() => {
    installTestLocalStorage();
    homeRenderMode = 'suspend';
    authMock.state = { ...authMock.signedInAuth, refresh: vi.fn(), signOut: vi.fn() };
    window.localStorage.clear();
    Object.defineProperty(window, 'scrollTo', {
      configurable: true,
      value: vi.fn()
    });
    nativeBackMock.listeners.length = 0;
    nativeBackMock.urlOpenListeners.length = 0;
    nativeBackMock.addListener.mockClear();
    nativeBackMock.exitApp.mockClear();
    nativeBackMock.remove.mockClear();
    capacitorMock.isNativePlatform.mockReturnValue(true);
    capacitorMock.isPluginAvailable.mockReturnValue(true);
    capacitorMock.getPlatform.mockReturnValue('ios');
    pushRoutingMock.clearPendingPushRoute.mockClear();
    pushRoutingMock.readPendingPushRoute.mockReset();
    pushRoutingMock.readPendingPushRoute.mockReturnValue(null);
    pushServiceMock.addPushNotificationOpenListener.mockClear();
    pushServiceMock.ensureAndroidNotificationChannels.mockClear();
    pushServiceMock.lastListener = null;
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  it('keeps the app shell visible while a protected route is still loading', async () => {
    render(
      <MemoryRouter initialEntries={['/home']}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByRole('navigation', { name: 'Primary navigation' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Loading Home' })).toBeTruthy();
    expect(screen.queryByText('Loading page')).toBeNull();
    expect(screen.queryByText('Preparing your ALL PLAYS workspace...')).toBeNull();
    expect(screen.queryByText('Loading ALL PLAYS')).toBeNull();
  });

  it('uses the app shell skeleton while returning-user auth is still resolving', async () => {
    authMock.state = {
      ...authMock.signedInAuth,
      user: null,
      loading: true,
      roles: [],
      isParent: false
    };
    writeAuthBootstrapHint({ uid: 'user-1', email: 'parent@example.com', displayName: 'Pat Parent', roles: ['parent'] });

    render(
      <MemoryRouter initialEntries={['/home']}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByRole('navigation', { name: 'Primary navigation' })).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Loading Home' })).toBeTruthy();
    expect(screen.queryByText('Loading ALL PLAYS')).toBeNull();
  });

  it('keeps the full auth loader for first-time indeterminate auth without a hint', () => {
    authMock.state = {
      ...authMock.signedInAuth,
      user: null,
      loading: true,
      roles: [],
      isParent: false
    };

    render(
      <MemoryRouter initialEntries={['/home']}>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByText('Loading ALL PLAYS')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Primary navigation' })).toBeNull();
  });

  it('routes the dedicated public-team discovery screen ahead of dynamic team ids', async () => {
    render(
      <MemoryRouter initialEntries={['/teams/browse']}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText('Browse public teams page')).toBeTruthy();
    expect(screen.queryByText('Loading ALL PLAYS')).toBeNull();
  });

  it('routes the native officials assignments page', async () => {
    render(
      <MemoryRouter initialEntries={['/officials']}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText('Officials assignments page')).toBeTruthy();
    expect(screen.queryByText('Loading ALL PLAYS')).toBeNull();
  });

  it('skips push setup during signed-out boot', () => {
    authMock.state = {
      ...authMock.signedInAuth,
      user: null,
      loading: false,
      roles: [],
      isParent: false
    };

    render(
      <MemoryRouter initialEntries={['/auth']}>
        <App />
      </MemoryRouter>
    );

    expect(pushServiceMock.ensureAndroidNotificationChannels).not.toHaveBeenCalled();
    expect(pushServiceMock.addPushNotificationOpenListener).not.toHaveBeenCalled();
  });

  it('skips push setup on web but registers it once for signed-in native boot', async () => {
    capacitorMock.isNativePlatform.mockReturnValue(false);

    const firstRender = render(
      <MemoryRouter initialEntries={['/officials']}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText('Officials assignments page')).toBeTruthy();
    expect(pushServiceMock.ensureAndroidNotificationChannels).not.toHaveBeenCalled();
    expect(pushServiceMock.addPushNotificationOpenListener).not.toHaveBeenCalled();

    firstRender.unmount();
    capacitorMock.isNativePlatform.mockReturnValue(true);

    render(
      <MemoryRouter initialEntries={['/officials']}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText('Officials assignments page')).toBeTruthy();
    await waitFor(() => expect(pushServiceMock.ensureAndroidNotificationChannels).toHaveBeenCalledTimes(1));
    expect(pushServiceMock.addPushNotificationOpenListener).toHaveBeenCalledTimes(1);
  });

  it('preserves pending push routing after auth resolves in a native session', async () => {
    authMock.state = {
      ...authMock.signedInAuth,
      user: null,
      loading: true,
      roles: [],
      isParent: false
    };
    pushRoutingMock.readPendingPushRoute.mockImplementationOnce(() => '/messages').mockReturnValue(null);
    writeAuthBootstrapHint({ uid: 'user-1', email: 'parent@example.com', displayName: 'Pat Parent', roles: ['parent'] });

    const { rerender } = render(
      <MemoryRouter initialEntries={['/home']}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByRole('navigation', { name: 'Primary navigation' })).toBeTruthy();
    expect(pushServiceMock.ensureAndroidNotificationChannels).not.toHaveBeenCalled();

    authMock.state = { ...authMock.signedInAuth, refresh: vi.fn(), signOut: vi.fn() };
    rerender(
      <MemoryRouter initialEntries={['/home']}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText('Messages page')).toBeTruthy();
    await waitFor(() => expect(pushServiceMock.ensureAndroidNotificationChannels).toHaveBeenCalledTimes(1));
    expect(pushRoutingMock.clearPendingPushRoute).toHaveBeenCalledTimes(1);
  });

  it('keeps the app shell visible when a protected route throws while rendering', async () => {
    homeRenderMode = 'throw';

    render(
      <MemoryRouter initialEntries={['/home']}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByRole('navigation', { name: 'Primary navigation' })).toBeTruthy();
    expect(screen.getByRole('alert', { name: 'Screen error' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go home' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });

  it('routes Android hardware back from event detail to Schedule', async () => {
    render(
      <MemoryRouter initialEntries={['/schedule/team-1/game-1']}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText('Event detail page')).toBeTruthy();
    await waitFor(() => expect(nativeBackMock.listeners).toHaveLength(1));

    await act(async () => {
      nativeBackMock.listeners[0]({ canGoBack: true });
    });

    expect(await screen.findByText('Schedule page')).toBeTruthy();
  });

  it('routes native app links into the React app router', async () => {
    render(
      <MemoryRouter initialEntries={['/home']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(nativeBackMock.urlOpenListeners).toHaveLength(1));

    await act(async () => {
      nativeBackMock.urlOpenListeners[0]({ url: 'https://allplays.ai/app/schedule?range=week' });
    });

    expect(await screen.findByText('Schedule page')).toBeTruthy();
  });

  it('clears Home query-only state before showing the native exit prompt', async () => {
    render(
      <MemoryRouter initialEntries={['/home?section=feed&social=create']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(nativeBackMock.listeners).toHaveLength(1));

    await act(async () => {
      nativeBackMock.listeners[0]({ canGoBack: false });
    });

    expect(screen.queryByText('Press back again to exit')).toBeNull();
    expect(nativeBackMock.exitApp).not.toHaveBeenCalled();

    await act(async () => {
      nativeBackMock.listeners[0]({ canGoBack: false });
    });

    expect(screen.queryByText('Press back again to exit')).toBeNull();
    expect(nativeBackMock.exitApp).not.toHaveBeenCalled();

    await act(async () => {
      nativeBackMock.listeners[0]({ canGoBack: false });
    });

    expect(screen.getByText('Press back again to exit')).toBeTruthy();
    expect(nativeBackMock.exitApp).not.toHaveBeenCalled();
  });

  it('prompts on first bare Home back press and exits on the second', async () => {
    render(
      <MemoryRouter initialEntries={['/home']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(nativeBackMock.listeners).toHaveLength(1));

    await act(async () => {
      nativeBackMock.listeners[0]({ canGoBack: false });
    });

    expect(screen.getByText('Press back again to exit')).toBeTruthy();
    expect(nativeBackMock.exitApp).not.toHaveBeenCalled();

    await act(async () => {
      nativeBackMock.listeners[0]({ canGoBack: false });
    });

    expect(nativeBackMock.exitApp).toHaveBeenCalledTimes(1);
  });
});
