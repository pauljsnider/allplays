// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppSearchDialog } from './AppSearchDialog';
import type { AppSearchPlayer, AppSearchTeam } from '../lib/searchService';
import type { AuthState } from '../lib/types';

const { navigateMock, preloadSearchRouteMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  preloadSearchRouteMock: vi.fn(async () => true),
}));

const { capacitorMocks } = vi.hoisted(() => ({
  capacitorMocks: {
    isNativePlatform: vi.fn(() => false),
  }
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: capacitorMocks,
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('../lib/publicActions', () => ({
  openPublicUrl: vi.fn(),
}));

vi.mock('../lib/searchRoutePreload', () => ({
  preloadSearchRoute: preloadSearchRouteMock,
}));

const {
  getKnownAppSearchTeamsMock,
  loadAppSearchTeamsMock,
  searchAppTeamsMock,
  searchAppPlayersMock,
} = vi.hoisted(() => ({
  getKnownAppSearchTeamsMock: vi.fn((): AppSearchTeam[] => []),
  loadAppSearchTeamsMock: vi.fn(async (): Promise<AppSearchTeam[]> => [{ id: 'team-2', name: 'Rockets', sport: 'Soccer', zip: '64114' }]),
  searchAppTeamsMock: vi.fn<(query: string, teams: AppSearchTeam[], user: AuthState['user']) => Promise<AppSearchTeam[]>>(),
  searchAppPlayersMock: vi.fn<(query: string, teamsById: Map<string, AppSearchTeam>, user: AuthState['user']) => Promise<any[]>>(),
}));

vi.mock('../lib/searchService', () => ({
  computeAppSearchResults: ({ queryText, players, helpRoleFilter, teams }: {
    queryText: string;
    teams: Array<{ id: string; name: string; sport?: string; zip?: string }>;
    players: Array<{ id: string; title: string; subtitle?: string; route?: string }>;
    helpRoleFilter: 'all' | 'parent' | 'coach' | 'admin' | 'member';
  }) => {
    const normalizedQuery = queryText.trim().toLowerCase();
    const actionItems = [{ id: 'browse-teams', kind: 'action', title: 'Browse Teams', subtitle: 'Explore public teams', route: '/teams' }];
    const teamItems = teams.map((team) => ({
      id: `team:${team.id}`,
      kind: 'team',
      title: team.name,
      subtitle: [team.sport, team.zip].filter(Boolean).join(' • '),
      route: `/teams/${team.id}`,
    }));
    const allHelpItems = normalizedQuery.length >= 2
      ? [{
          id: 'help:coach-search',
          kind: 'help',
          title: 'Search like a coach',
          subtitle: 'Use filters to find coaching answers fast',
          route: '/help/coach-search',
          roles: ['coach']
        }]
      : [];
    const helpItems = helpRoleFilter === 'all'
      ? allHelpItems
      : allHelpItems.filter((item) => item.roles?.includes(helpRoleFilter));
    return {
      actions: actionItems,
      teams: teamItems,
      help: helpItems,
      players,
      flat: [...actionItems, ...teamItems, ...helpItems, ...players],
    };
  },
  getKnownAppSearchTeams: getKnownAppSearchTeamsMock,
  loadAppSearchTeams: loadAppSearchTeamsMock,
  searchAppTeams: searchAppTeamsMock,
  searchAppPlayers: searchAppPlayersMock,
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

describe('AppSearchDialog', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    capacitorMocks.isNativePlatform.mockReturnValue(false);
    getKnownAppSearchTeamsMock.mockReturnValue([]);
    loadAppSearchTeamsMock.mockResolvedValue([{ id: 'team-2', name: 'Rockets', sport: 'Soccer', zip: '64114' }]);
    searchAppTeamsMock.mockImplementation(async (_query, teams) => teams);
    searchAppPlayersMock.mockResolvedValue([]);
    preloadSearchRouteMock.mockImplementation(async () => true);
  });

  it('shows player guidance while keeping player results hidden until search has a real query', async () => {
    const onClose = vi.fn();

    render(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={true} onClose={onClose} />
      </MemoryRouter>
    );

    expect(screen.queryByLabelText('Filter help by role')).toBeNull();
    expect(screen.getByText('Players')).not.toBeNull();
    expect(screen.getByText('Type at least 2 characters to search players')).not.toBeNull();

    fireEvent.change(screen.getByLabelText('Search teams, players, actions, help'), { target: { value: ' r ' } });

    await waitFor(() => expect(screen.queryByLabelText('Filter help by role')).toBeNull());
    expect(screen.getByText('Players')).not.toBeNull();
    expect(screen.getByText('Type at least 2 characters to search players')).not.toBeNull();
  });

  it('adds a native keyboard inset when the visual viewport is partially obscured', async () => {
    const onClose = vi.fn();
    const originalVisualViewport = window.visualViewport;
    const originalInnerHeight = window.innerHeight;
    const listeners = new Map<string, Set<() => void>>();
    let viewportHeight = 800;
    const viewportOffsetTop = 0;

    const emit = (eventName: string) => {
      listeners.get(eventName)?.forEach((listener) => listener());
    };

    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 800,
    });

    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        get height() {
          return viewportHeight;
        },
        get offsetTop() {
          return viewportOffsetTop;
        },
        addEventListener: (eventName: string, listener: () => void) => {
          if (!listeners.has(eventName)) listeners.set(eventName, new Set());
          listeners.get(eventName)?.add(listener);
        },
        removeEventListener: (eventName: string, listener: () => void) => {
          listeners.get(eventName)?.delete(listener);
        },
      },
    });

    capacitorMocks.isNativePlatform.mockReturnValue(true);

    try {
      render(
        <MemoryRouter>
          <AppSearchDialog auth={auth} open={true} onClose={onClose} />
        </MemoryRouter>
      );

      const dialog = screen.getByRole('dialog', { name: 'Search teams, players, actions, and help' });
      expect(dialog).toHaveAttribute('data-keyboard-visible', 'false');
      expect(dialog).toHaveStyle('--app-search-keyboard-inset: 0px');

      viewportHeight = 520;
      act(() => {
        emit('resize');
      });

      await waitFor(() => {
        expect(dialog).toHaveAttribute('data-keyboard-visible', 'true');
        expect(dialog).toHaveStyle('--app-search-keyboard-inset: 280px');
      });

      viewportHeight = 800;
      act(() => {
        emit('resize');
      });

      await waitFor(() => {
        expect(dialog).toHaveAttribute('data-keyboard-visible', 'false');
        expect(dialog).toHaveStyle('--app-search-keyboard-inset: 0px');
      });
    } finally {
      Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: originalVisualViewport,
      });
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: originalInnerHeight,
      });
    }
  });

  it('shows help results without role filters once the query reaches two characters', async () => {
    const onClose = vi.fn();
    searchAppPlayersMock.mockResolvedValueOnce([{
      id: 'player:team-2:player-2',
      kind: 'player',
      title: '#10 Rocket Kid',
      subtitle: 'Rockets',
      route: '/players/team-2/player-2',
      teamId: 'team-2',
      playerId: 'player-2',
    }]);

    render(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={true} onClose={onClose} />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText('Search teams, players, actions, help'), { target: { value: 'ro' } });

    await waitFor(() => expect(screen.queryByLabelText('Filter help by role')).toBeNull());
    expect(await screen.findByText('Players')).not.toBeNull();
    expect(await screen.findByRole('button', { name: /#10 Rocket Kid/i })).not.toBeNull();
    expect(screen.getByRole('button', { name: /Search like a coach/i })).not.toBeNull();
    expect(screen.getByRole('button', { name: /More help results/i })).not.toBeNull();
  });

  it('opens the help portal with the current query preserved', async () => {
    const onClose = vi.fn();

    render(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={true} onClose={onClose} />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText('Search teams, players, actions, help'), { target: { value: 'ro' } });

    const moreHelpResultsButton = await screen.findByRole('button', { name: /More help results/i });
    fireEvent.click(moreHelpResultsButton);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith('/help', {
      state: {
        helpQuery: 'ro',
        helpRoleFilter: 'all'
      }
    });
  });

  it('lets Enter activate the more help results button instead of the highlighted result', async () => {
    const onClose = vi.fn();

    render(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={true} onClose={onClose} />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText('Search teams, players, actions, help'), { target: { value: 'ro' } });

    const moreHelpResultsButton = await screen.findByRole('button', { name: /More help results/i });
    moreHelpResultsButton.focus();
    fireEvent.keyDown(moreHelpResultsButton, { key: 'Enter' });

    expect(onClose).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();

    fireEvent.click(moreHelpResultsButton);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith('/help', {
      state: {
        helpQuery: 'ro',
        helpRoleFilter: 'all'
      }
    });
  });

  it('keeps the opening tap guard active long enough for slower mobile pointer sequences', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    render(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={true} onClose={onClose} />
      </MemoryRouter>
    );

    const dialog = screen.getByRole('dialog', { name: 'Search teams, players, actions, and help' });
    fireEvent.mouseDown(dialog);
    expect(onClose).not.toHaveBeenCalled();

    now = 1_600;
    await vi.advanceTimersByTimeAsync(600);
    fireEvent.mouseDown(dialog);
    expect(onClose).not.toHaveBeenCalled();

    now = 1_900;
    await vi.advanceTimersByTimeAsync(300);
    fireEvent.mouseDown(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes from a backdrop mousedown after the guard window but not from pressing inside the search panel', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();

    render(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={true} onClose={onClose} />
      </MemoryRouter>
    );

    fireEvent.mouseDown(screen.getByTestId('app-search-panel'));
    expect(onClose).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog', { name: 'Search teams, players, actions, and help' });
    expect(screen.getByRole('heading', { name: 'Search teams, players, actions, and help' }).className).toContain('sr-only');

    await vi.advanceTimersByTimeAsync(800);
    fireEvent.mouseDown(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('preloads a keyboard-highlighted route before Enter and reuses it on navigation', async () => {
    const onClose = vi.fn();
    let releasePreload!: () => void;
    preloadSearchRouteMock.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      releasePreload = () => resolve(true);
    }));
    getKnownAppSearchTeamsMock.mockReturnValue([{ id: 'team-2', name: 'Rockets', sport: 'Soccer', zip: '64114' }]);

    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="*" element={<AppSearchDialog auth={auth} open={true} onClose={onClose} />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByRole('button', { name: /Rockets/ });
    const dialog = screen.getByRole('dialog', { name: 'Search teams, players, actions, and help' });
    fireEvent.keyDown(dialog, { key: 'ArrowDown' });

    await waitFor(() => expect(preloadSearchRouteMock).toHaveBeenCalledWith('/teams/team-2'));
    expect(navigateMock).not.toHaveBeenCalled();

    fireEvent.keyDown(dialog, { key: 'Enter' });
    expect(navigateMock).toHaveBeenCalledWith('/teams/team-2');

    releasePreload();
    await waitFor(() => expect(preloadSearchRouteMock).toHaveBeenCalledTimes(1));
  });

  it('dedupes repeated hover preloads for the same route within one dialog session', async () => {
    const onClose = vi.fn();
    getKnownAppSearchTeamsMock.mockReturnValue([{ id: 'team-2', name: 'Rockets', sport: 'Soccer', zip: '64114' }]);

    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="*" element={<AppSearchDialog auth={auth} open={true} onClose={onClose} />} />
        </Routes>
      </MemoryRouter>
    );

    const rocketsResult = await screen.findByRole('button', { name: /Rockets/ });
    fireEvent.mouseEnter(rocketsResult);
    fireEvent.mouseEnter(rocketsResult);
    fireEvent.click(rocketsResult);

    await waitFor(() => expect(preloadSearchRouteMock).toHaveBeenCalledWith('/teams/team-2'));
    expect(preloadSearchRouteMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith('/teams/team-2');
  });

  it('starts loading accessible teams on open and reuses that warm load for the first query', async () => {
    const onClose = vi.fn();

    render(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={true} onClose={onClose} />
      </MemoryRouter>
    );

    expect(await screen.findAllByRole('button', { name: /Browse Teams/ })).not.toHaveLength(0);
    await waitFor(() => expect(loadAppSearchTeamsMock).toHaveBeenCalledTimes(1));
    expect(searchAppTeamsMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Search teams, players, actions, help'), { target: { value: 'ro' } });
    await waitFor(() => expect(searchAppTeamsMock).toHaveBeenCalledWith('ro', expect.arrayContaining([
      expect.objectContaining({ id: 'team-2', name: 'Rockets' })
    ]), null));
    expect(loadAppSearchTeamsMock).toHaveBeenCalledTimes(1);
  });

  it('waits briefly for hydrated access so the first query runs once with the expanded scope', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const initialTeams: AppSearchTeam[] = [{ id: 'team-1', name: 'Bears', sport: 'Basketball', zip: '66210' }];
    const hydratedTeams: AppSearchTeam[] = [
      ...initialTeams,
      { id: 'team-2', name: 'Rockets', sport: 'Soccer', zip: '64114' }
    ];
    let releaseHydration!: (teams: AppSearchTeam[] | PromiseLike<AppSearchTeam[]>) => void;

    getKnownAppSearchTeamsMock.mockReturnValue(initialTeams);
    loadAppSearchTeamsMock.mockImplementationOnce(() => new Promise((resolve) => {
      releaseHydration = resolve;
    }));

    render(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={true} onClose={onClose} />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText('Search teams, players, actions, help'), { target: { value: 'be' } });

    await vi.advanceTimersByTimeAsync(180);
    expect(searchAppTeamsMock).not.toHaveBeenCalled();
    expect(searchAppPlayersMock).not.toHaveBeenCalled();

    releaseHydration(hydratedTeams);
    await vi.advanceTimersByTimeAsync(250);
    await Promise.resolve();

    expect(searchAppTeamsMock).toHaveBeenCalledTimes(1);
    expect(searchAppPlayersMock).toHaveBeenCalledTimes(1);
    expect(searchAppTeamsMock).toHaveBeenNthCalledWith(1, 'be', hydratedTeams, null);
    expect(searchAppPlayersMock).toHaveBeenNthCalledWith(1, 'be', expect.any(Map), null);
  });

  it('ignores stale hydrated teams after the dialog closes before warm loading finishes', async () => {
    const onClose = vi.fn();
    const userA = { uid: 'user-a', email: 'a@example.com' } as NonNullable<AuthState['user']>;
    let releaseHydration!: (teams: AppSearchTeam[] | PromiseLike<AppSearchTeam[]>) => void;
    getKnownAppSearchTeamsMock.mockReturnValue([{ id: 'team-1', name: 'Bears', sport: 'Basketball', zip: '66210' }]);
    loadAppSearchTeamsMock.mockImplementationOnce(() => new Promise((resolve) => {
      releaseHydration = resolve;
    }));

    const { rerender } = render(
      <MemoryRouter>
        <AppSearchDialog auth={{ ...auth, user: userA }} open={true} onClose={onClose} />
      </MemoryRouter>
    );

    await waitFor(() => expect(getKnownAppSearchTeamsMock).toHaveBeenCalledWith(userA));

    rerender(
      <MemoryRouter>
        <AppSearchDialog auth={{ ...auth, user: userA }} open={false} onClose={onClose} />
      </MemoryRouter>
    );

    releaseHydration([{ id: 'team-2', name: 'Rockets', sport: 'Soccer', zip: '64114' }]);
    await waitFor(() => expect(loadAppSearchTeamsMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: /Rockets/ })).toBeNull();
  });

  it('does not rerun hydrated searches when accessible teams stay the same', async () => {
    const onClose = vi.fn();
    const initialTeams: AppSearchTeam[] = [{ id: 'team-1', name: 'Bears', sport: 'Basketball', zip: '66210' }];

    getKnownAppSearchTeamsMock.mockReturnValue(initialTeams);
    loadAppSearchTeamsMock.mockResolvedValue([...initialTeams]);

    render(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={true} onClose={onClose} />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText('Search teams, players, actions, help'), { target: { value: 'zzzz' } });

    await waitFor(() => expect(searchAppTeamsMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(searchAppPlayersMock).toHaveBeenCalledTimes(1));
  });

  it('reruns team and player search once hydrated access expands after a provisional fallback search', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const initialTeams: AppSearchTeam[] = [{ id: 'team-1', name: 'Bears', sport: 'Basketball', zip: '66210' }];
    const hydratedTeams: AppSearchTeam[] = [
      ...initialTeams,
      { id: 'team-2', name: 'Rockets', sport: 'Soccer', zip: '64114' }
    ];
    const initialPlayers: AppSearchPlayer[] = [{
      id: 'player:team-1:player-1',
      kind: 'player',
      title: '#9 Roc Star',
      subtitle: 'Bears',
      route: '/players/team-1/player-1',
      teamId: 'team-1',
      playerId: 'player-1',
    }];
    const hydratedPlayers: AppSearchPlayer[] = [
      ...initialPlayers,
      {
        id: 'player:team-2:player-2',
        kind: 'player',
        title: '#10 Rocket Kid',
        subtitle: 'Rockets',
        route: '/players/team-2/player-2',
        teamId: 'team-2',
        playerId: 'player-2',
      }
    ];
    let releaseHydration!: (teams: AppSearchTeam[] | PromiseLike<AppSearchTeam[]>) => void;

    getKnownAppSearchTeamsMock.mockReturnValue(initialTeams);
    loadAppSearchTeamsMock.mockImplementationOnce(() => new Promise((resolve) => {
      releaseHydration = resolve;
    }));
    searchAppPlayersMock.mockImplementation(async (_query, teamsById) => teamsById.has('team-2') ? hydratedPlayers : initialPlayers);

    render(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={true} onClose={onClose} />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText('Search teams, players, actions, help'), { target: { value: 'ro' } });

    await vi.advanceTimersByTimeAsync(430);
    await Promise.resolve();
    expect(searchAppTeamsMock).toHaveBeenCalledTimes(1);
    expect(searchAppPlayersMock).toHaveBeenCalledTimes(1);
    expect(searchAppTeamsMock).toHaveBeenNthCalledWith(1, 'ro', initialTeams, null);
    expect(searchAppPlayersMock).toHaveBeenNthCalledWith(1, 'ro', expect.any(Map), null);

    releaseHydration(hydratedTeams);
    await vi.advanceTimersByTimeAsync(50);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(searchAppTeamsMock).toHaveBeenCalledTimes(2);
    expect(searchAppPlayersMock).toHaveBeenCalledTimes(2);
    expect(searchAppTeamsMock).toHaveBeenNthCalledWith(2, 'ro', hydratedTeams, null);
    expect(searchAppPlayersMock).toHaveBeenNthCalledWith(2, 'ro', expect.any(Map), null);
    expect(Array.from(searchAppPlayersMock.mock.calls[1][1].values())).toEqual(hydratedTeams);
  });

  it('falls back to provisional search results when hydrated team loading fails', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const initialTeams: AppSearchTeam[] = [{ id: 'team-1', name: 'Bears', sport: 'Basketball', zip: '66210' }];

    getKnownAppSearchTeamsMock.mockReturnValue(initialTeams);
    loadAppSearchTeamsMock.mockRejectedValueOnce(new Error('hydration failed'));

    render(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={true} onClose={onClose} />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText('Search teams, players, actions, help'), { target: { value: 'be' } });

    await vi.advanceTimersByTimeAsync(430);
    await Promise.resolve();
    expect(searchAppTeamsMock).toHaveBeenCalledTimes(1);
    expect(searchAppPlayersMock).toHaveBeenCalledTimes(1);
    expect(searchAppTeamsMock).toHaveBeenNthCalledWith(1, 'be', initialTeams, null);
  });
});
