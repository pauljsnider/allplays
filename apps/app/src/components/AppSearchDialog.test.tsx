import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AppSearchDialog } from './AppSearchDialog';
import type { AuthState } from '../lib/types';

const { preloadSearchRouteMock } = vi.hoisted(() => ({
  preloadSearchRouteMock: vi.fn(async () => true),
}));

vi.mock('../lib/publicActions', () => ({
  openPublicUrl: vi.fn(),
}));

vi.mock('../lib/searchRoutePreload', () => ({
  preloadSearchRoute: preloadSearchRouteMock,
}));

vi.mock('../lib/searchService', () => ({
  computeAppSearchResults: ({ teams }: { teams: Array<{ id: string; name: string; sport?: string; zip?: string }> }) => ({
    actions: [],
    teams: teams.map((team) => ({
      id: `team:${team.id}`,
      kind: 'team',
      title: team.name,
      subtitle: [team.sport, team.zip].filter(Boolean).join(' • '),
      route: `/teams/${team.id}`,
    })),
    help: [],
    players: [],
    flat: teams.map((team) => ({
      id: `team:${team.id}`,
      kind: 'team',
      title: team.name,
      subtitle: [team.sport, team.zip].filter(Boolean).join(' • '),
      route: `/teams/${team.id}`,
    })),
  }),
  loadAppSearchTeams: vi.fn(async () => [{ id: 'team-2', name: 'Rockets', sport: 'Soccer', zip: '64114' }]),
  searchAppPlayers: vi.fn(async () => []),
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

function RouteEcho() {
  const location = useLocation();
  return <div data-testid="route">{location.pathname}</div>;
}

describe('AppSearchDialog', () => {
  it('closes from a backdrop mousedown but not from pressing inside the search panel', () => {
    const onClose = vi.fn();

    render(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={true} onClose={onClose} />
      </MemoryRouter>
    );

    fireEvent.mouseDown(screen.getByTestId('app-search-panel'));
    expect(onClose).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog', { name: 'Search teams, players, actions, and help' });
    fireEvent.mouseDown(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('preloads team routes before navigating from a search result', async () => {
    const onClose = vi.fn();

    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="*" element={<><RouteEcho /><AppSearchDialog auth={auth} open={true} onClose={onClose} /></>} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole('button', { name: /Rockets/ }));

    await waitFor(() => expect(preloadSearchRouteMock).toHaveBeenCalledWith('/teams/team-2'));
    await waitFor(() => expect(screen.getByTestId('route')).toHaveTextContent('/teams/team-2'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
