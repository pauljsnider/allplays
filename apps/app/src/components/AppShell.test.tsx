// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';
import type { AuthState } from '../lib/types';
import { APP_BACK_DISMISS_EVENT } from '../lib/nativeBackButton';

vi.mock('../lib/useShellLayout', () => ({
  useShellLayout: () => ({ isDesktopWeb: true }),
}));

vi.mock('../lib/uxTiming', () => ({
  recordUxTiming: vi.fn(),
}));

vi.mock('./AppSearchDialog', () => ({
  AppSearchDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Search teams, players, actions, and help" /> : null),
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

describe('AppShell', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
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
  });

  it('opens the search dialog immediately when the desktop search button is clicked', () => {
    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<AppShell auth={auth}><div>Home</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByRole('dialog', { name: 'Search teams, players, actions, and help' })).toBeTruthy();
  });

  it('opens the search dialog from the Ctrl+K shortcut before browser chrome can consume it', () => {
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
    expect(screen.getByRole('dialog', { name: 'Search teams, players, actions, and help' })).toBeTruthy();
  });

  it('dismisses the search dialog when native back asks overlays to close', () => {
    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<AppShell auth={auth}><div>Home</div></AppShell>} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByRole('dialog', { name: 'Search teams, players, actions, and help' })).toBeTruthy();

    const event = new Event(APP_BACK_DISMISS_EVENT, { cancelable: true });
    act(() => {
      window.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(screen.queryByRole('dialog', { name: 'Search teams, players, actions, and help' })).toBeNull();
  });
});
