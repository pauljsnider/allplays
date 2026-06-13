// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import App from './App';

const suspendedHomePromise = new Promise<never>(() => {});

vi.mock('./lib/useAuth', () => ({
  useAuth: () => ({
    user: { uid: 'user-1', email: 'parent@example.com', displayName: 'Pat Parent' },
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
  }),
}));

vi.mock('./components/AppShell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => (
    <div>
      <nav aria-label="Primary navigation">Shell navigation</nav>
      <div>{children}</div>
    </div>
  ),
}));

vi.mock('./lib/pushNotificationRouting', () => ({
  clearPendingPushRoute: vi.fn(),
  readPendingPushRoute: vi.fn(() => null),
}));

vi.mock('./lib/reloadRouting', () => ({
  shouldReloadTeamsToHome: vi.fn(() => false),
}));

vi.mock('./lib/pushService', () => ({
  addPushNotificationOpenListener: vi.fn(async () => () => {}),
  ensureAndroidNotificationChannels: vi.fn(async () => {}),
}));

vi.mock('./pages/Home', () => ({
  Home: () => {
    throw suspendedHomePromise;
  },
}));

vi.mock('./pages/PublicTeamsBrowse', () => ({
  PublicTeamsBrowse: () => <div>Browse public teams page</div>,
}));

vi.mock('./pages/Officials', () => ({
  Officials: () => <div>Officials assignments page</div>,
}));

describe('App protected route loading', () => {
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
});
