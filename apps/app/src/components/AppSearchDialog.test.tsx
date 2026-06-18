// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppSearchDialog } from './AppSearchDialog';
import type { AppSearchPlayer, AppSearchTeam } from '../lib/searchService';
import type { AuthState } from '../lib/types';

const { navigateMock, preloadSearchRouteMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  preloadSearchRouteMock: vi.fn(async () => true),
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
  getCachedAppPlayerSearchResultsMock,
  hasSatisfiedAppPlayerSearchResultBudgetMock,
} = vi.hoisted(() => ({
  getKnownAppSearchTeamsMock: vi.fn((): AppSearchTeam[] => []),
  loadAppSearchTeamsMock: vi.fn(async (): Promise<AppSearchTeam[]> => [{ id: 'team-2', name: 'Rockets', sport: 'Soccer', zip: '64114' }]),
  searchAppTeamsMock: vi.fn<(query: string, teams: AppSearchTeam[], user: AuthState['user']) => Promise<AppSearchTeam[]>>(),
  searchAppPlayersMock: vi.fn<(query: string, teamsById: Map<string, AppSearchTeam>, user: AuthState['user']) => Promise<AppSearchPlayer[]>>(),
  getCachedAppPlayerSearchResultsMock: vi.fn<(query: string, teamsById: Map<string, AppSearchTeam>, user: AuthState['user']) => AppSearchPlayer[] | null>(() => null),
  hasSatisfiedAppPlayerSearchResultBudgetMock: vi.fn(() => false),
}));

vi.mock('../lib/searchService', () => ({
  computeAppSearchResults: ({ teams }: { teams: Array<{ id: string; name: string; sport?: string; zip?: string }> }) => {
    const actionItems = [{ id: 'browse-teams', kind: 'action', title: 'Browse Teams', subtitle: 'Explore public teams', route: '/teams' }];
    const teamItems = teams.map((team) => ({
      id: `team:${team.id}`,
      kind: 'team',
      title: team.name,
      subtitle: [team.sport, team.zip].filter(Boolean).join(' • '),
      route: `/teams/${team.id}`,
    }));
    return {
      actions: actionItems,
      teams: teamItems,
      help: [],
      players: [],
      flat: [...actionItems, ...teamItems],
    };
  },
  getCachedAppPlayerSearchResults: getCachedAppPlayerSearchResultsMock,
  getKnownAppSearchTeams: getKnownAppSearchTeamsMock,
  hasSatisfiedAppPlayerSearchResultBudget: hasSatisfiedAppPlayerSearchResultBudgetMock,
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

function buildPlayers(count: number, query: string): AppSearchPlayer[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `player:team-1:${query}-${index}`,
    kind: 'player',
    title: `#${index} ${query} player ${index}`,
    subtitle: 'Bears',
    route: `/players/team-1/${query}-${index}`,
    teamId: 'team-1',
    playerId: `${query}-${index}`,
  }));
}

describe('AppSearchDialog', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    getKnownAppSearchTeamsMock.mockReturnValue([]);
    loadAppSearchTeamsMock.mockResolvedValue([{ id: 'team-2', name: 'Rockets', sport: 'Soccer', zip: '64114' }]);
    searchAppTeamsMock.mockImplementation(async (_query, teams) => teams);
    searchAppPlayersMock.mockResolvedValue([]);
    getCachedAppPlayerSearchResultsMock.mockReturnValue(null);
    hasSatisfiedAppPlayerSearchResultBudgetMock.mockReturnValue(false);
    preloadSearchRouteMock.mockImplementation(async () => true);
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

  it('starts search with known access and reruns after hydration expands the scope', async () => {
    const onClose = vi.fn();
    const initialTeams: AppSearchTeam[] = [{ id: 'team-1', name: 'Bears', sport: 'Basketball', zip: '66210' }];
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

    await waitFor(() => expect(searchAppTeamsMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(searchAppPlayersMock).toHaveBeenCalledTimes(1));
    expect(searchAppTeamsMock).toHaveBeenNthCalledWith(1, 'be', initialTeams, null);
    expect(searchAppPlayersMock).toHaveBeenNthCalledWith(1, 'be', expect.any(Map), null);

    releaseHydration([{ id: 'team-2', name: 'Rockets', sport: 'Soccer', zip: '64114' }]);

    await waitFor(() => expect(searchAppTeamsMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(searchAppPlayersMock).toHaveBeenCalledTimes(2));
    expect(searchAppTeamsMock).toHaveBeenNthCalledWith(2, 'be', expect.arrayContaining([
      expect.objectContaining({ id: 'team-1', name: 'Bears' }),
      expect.objectContaining({ id: 'team-2', name: 'Rockets' })
    ]), null);
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

  it('skips the hydrated player rerun when the current query already satisfied the result budget', async () => {
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
    hasSatisfiedAppPlayerSearchResultBudgetMock.mockReturnValue(true);

    render(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={true} onClose={onClose} />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText('Search teams, players, actions, help'), { target: { value: 'ro' } });

    await waitFor(() => expect(searchAppTeamsMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(searchAppPlayersMock).toHaveBeenCalledTimes(1));

    releaseHydration(hydratedTeams);

    await waitFor(() => expect(searchAppTeamsMock).toHaveBeenCalledTimes(2));
    expect(searchAppPlayersMock).toHaveBeenCalledTimes(1);
  });

  it('skips the hydrated player rerun when cached hydrated results can answer the query', async () => {
    const onClose = vi.fn();
    const initialTeams: AppSearchTeam[] = [{ id: 'team-1', name: 'Bears', sport: 'Basketball', zip: '66210' }];
    const hydratedTeams: AppSearchTeam[] = [
      ...initialTeams,
      { id: 'team-2', name: 'Rockets', sport: 'Soccer', zip: '64114' }
    ];

    getKnownAppSearchTeamsMock.mockReturnValue(initialTeams);
    loadAppSearchTeamsMock.mockResolvedValue(hydratedTeams);
    getCachedAppPlayerSearchResultsMock.mockReturnValue([
      {
        id: 'player:team-2:player-1',
        kind: 'player',
        title: '#9 Rocket Runner',
        subtitle: 'Rockets',
        route: '/players/team-2/player-1',
        teamId: 'team-2',
        playerId: 'player-1',
      },
    ]);

    render(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={true} onClose={onClose} />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText('Search teams, players, actions, help'), { target: { value: 'ro' } });

    await waitFor(() => expect(searchAppTeamsMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(searchAppPlayersMock).toHaveBeenCalledTimes(1));
    expect(getCachedAppPlayerSearchResultsMock).toHaveBeenCalledWith('ro', expect.any(Map), null);
  });

  it('reruns hydrated player search when the current query still has stale players from a previous query', async () => {
    const onClose = vi.fn();
    const initialTeams: AppSearchTeam[] = [{ id: 'team-1', name: 'Bears', sport: 'Basketball', zip: '66210' }];
    const hydratedTeams: AppSearchTeam[] = [
      ...initialTeams,
      { id: 'team-2', name: 'Rockets', sport: 'Soccer', zip: '64114' }
    ];
    let releaseHydration!: (teams: AppSearchTeam[] | PromiseLike<AppSearchTeam[]>) => void;
    let resolveSecondQueryPlayers!: (players: AppSearchPlayer[]) => void;

    getKnownAppSearchTeamsMock.mockReturnValue(initialTeams);
    loadAppSearchTeamsMock.mockImplementationOnce(() => new Promise((resolve) => {
      releaseHydration = resolve;
    }));
    searchAppPlayersMock.mockImplementation((query) => {
      if (query === 'al') {
        return Promise.resolve(buildPlayers(20, query));
      }
      if (query === 'be') {
        return new Promise((resolve) => {
          resolveSecondQueryPlayers = resolve;
        });
      }
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={true} onClose={onClose} />
      </MemoryRouter>
    );

    const input = screen.getByLabelText('Search teams, players, actions, help');
    fireEvent.change(input, { target: { value: 'al' } });
    await waitFor(() => expect(searchAppPlayersMock.mock.calls.filter(([query]) => query === 'al')).toHaveLength(1));

    searchAppTeamsMock.mockClear();
    searchAppPlayersMock.mockClear();

    fireEvent.change(input, { target: { value: 'be' } });
    await waitFor(() => expect(searchAppPlayersMock).toHaveBeenCalledTimes(1));

    releaseHydration(hydratedTeams);

    await waitFor(() => expect(searchAppTeamsMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(searchAppPlayersMock).toHaveBeenCalledTimes(2));
    expect(searchAppPlayersMock.mock.calls.filter(([query]) => query === 'be')).toHaveLength(2);

    resolveSecondQueryPlayers([]);
    await waitFor(() => expect(searchAppPlayersMock).toHaveBeenCalledTimes(2));
  });

  it('reruns search with the hydrated team scope when access expands', async () => {
    const onClose = vi.fn();
    const initialTeams: AppSearchTeam[] = [{ id: 'team-1', name: 'Bears', sport: 'Basketball', zip: '66210' }];
    const hydratedTeams: AppSearchTeam[] = [
      ...initialTeams,
      { id: 'team-2', name: 'Rockets', sport: 'Soccer', zip: '64114' }
    ];

    getKnownAppSearchTeamsMock.mockReturnValue(initialTeams);
    loadAppSearchTeamsMock.mockResolvedValue(hydratedTeams);

    render(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={true} onClose={onClose} />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText('Search teams, players, actions, help'), { target: { value: 'ro' } });

    await waitFor(() => expect(searchAppTeamsMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(searchAppPlayersMock).toHaveBeenCalledTimes(2));
    expect(searchAppTeamsMock).toHaveBeenNthCalledWith(1, 'ro', initialTeams, null);
    expect(searchAppTeamsMock).toHaveBeenNthCalledWith(2, 'ro', hydratedTeams, null);
    expect(searchAppPlayersMock).toHaveBeenNthCalledWith(2, 'ro', expect.any(Map), null);
    const teamsById = searchAppPlayersMock.mock.calls[1]?.[1];
    expect(teamsById instanceof Map).toBe(true);
    expect(Array.from((teamsById as Map<string, AppSearchTeam>).keys())).toEqual(['team-1', 'team-2']);
  });
});
