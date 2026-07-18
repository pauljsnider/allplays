// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppSearchDialog } from './AppSearchDialog';
import { Modal } from './Modal';
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
  getImmediateAppTeamSearchResultsMock,
  getKnownAppSearchTeamsMock,
  loadAppSearchTeamsMock,
  searchAppTeamsMock,
  searchAppPlayersMock,
} = vi.hoisted(() => ({
  getImmediateAppTeamSearchResultsMock: vi.fn((query: string, teams: AppSearchTeam[]) => {
    const normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery.length < 2) return teams;
    return teams.filter((team) => team.name.toLowerCase().includes(normalizedQuery));
  }),
  getKnownAppSearchTeamsMock: vi.fn((_user: AuthState['user']): AppSearchTeam[] => []),
  loadAppSearchTeamsMock: vi.fn(async (): Promise<AppSearchTeam[]> => [{ id: 'team-2', name: 'Rockets', sport: 'Soccer', zip: '64114' }]),
  searchAppTeamsMock: vi.fn<(
    query: string,
    teams: AppSearchTeam[],
    user: AuthState['user'],
    cursor?: unknown | null
  ) => Promise<AppSearchTeam[] | { teams: AppSearchTeam[]; nextCursor: unknown | null }>>(),
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
      ? [
        {
          id: 'help:parent-fees',
          kind: 'help',
          title: 'Parent fee guide',
          subtitle: 'Pay and track team fees',
          route: '/help/parent-fees',
          roles: ['parent']
        },
        {
          id: 'help:coach-search',
          kind: 'help',
          title: 'Search like a coach',
          subtitle: 'Use filters to find coaching answers fast',
          route: '/help/coach-search',
          roles: ['coach']
        }
      ]
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
  getImmediateAppTeamSearchResults: getImmediateAppTeamSearchResultsMock,
  getKnownAppSearchTeams: getKnownAppSearchTeamsMock,
  loadAppSearchTeams: loadAppSearchTeamsMock,
  searchAppTeams: searchAppTeamsMock,
  searchAppTeamsPage: searchAppTeamsMock,
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
    cleanup();
    document.body.style.overflow = '';
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
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

  it('locks body scrolling while open and restores the prior overflow after close or unmount', () => {
    const onClose = vi.fn();
    document.body.style.overflow = 'clip';
    const { rerender, unmount } = render(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={true} onClose={onClose} />
      </MemoryRouter>
    );

    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={false} onClose={onClose} />
      </MemoryRouter>
    );
    expect(document.body.style.overflow).toBe('clip');

    rerender(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={true} onClose={onClose} />
      </MemoryRouter>
    );
    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('clip');
  });

  it('keeps body scrolling locked when an overlapping modal closes before search', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={true} onClose={onClose} />
        <Modal ariaLabel="Add workflow" onClose={vi.fn()}>
          <button type="button">Close add workflow</button>
        </Modal>
      </MemoryRouter>
    );

    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={true} onClose={onClose} />
      </MemoryRouter>
    );

    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={false} onClose={onClose} />
      </MemoryRouter>
    );

    expect(document.body.style.overflow).toBe('');
  });

  it('uses mobile search hints and clears the query without closing or losing focus', async () => {
    const onClose = vi.fn();
    searchAppPlayersMock.mockRejectedValueOnce(new Error('Player search unavailable for this account.'));

    render(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={true} onClose={onClose} />
      </MemoryRouter>
    );

    const input = screen.getByLabelText('Search teams, players, actions, help');
    expect(input).toHaveAttribute('type', 'search');
    expect(input).toHaveAttribute('enterkeyhint', 'search');
    expect(input).toHaveAttribute('autocomplete', 'off');

    fireEvent.change(input, { target: { value: 'error' } });
    expect(await screen.findByText('Player search unavailable for this account.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Clear search query' }));

    await waitFor(() => expect(input).toHaveValue(''));
    expect(screen.getByRole('dialog', { name: 'Search teams, players, actions, and help' })).toBeTruthy();
    expect(screen.getByText('Type at least 2 characters to search players')).toBeTruthy();
    expect(screen.queryByText('Player search unavailable for this account.')).toBeNull();
    expect(input).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('lets Enter on the clear button stay scoped to clearing instead of opening the highlighted result', async () => {
    const onClose = vi.fn();

    render(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={true} onClose={onClose} />
      </MemoryRouter>
    );

    const input = screen.getByLabelText('Search teams, players, actions, help');
    fireEvent.change(input, { target: { value: 'ro' } });

    const clearButton = screen.getByRole('button', { name: 'Clear search query' });
    clearButton.focus();
    fireEvent.keyDown(clearButton, { key: 'Enter' });

    expect(navigateMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(clearButton);

    await waitFor(() => expect(input).toHaveValue(''));
    expect(input).toHaveFocus();
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

  it('shows help results for the signed-in user role once the query reaches two characters', async () => {
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
    expect(screen.getByRole('button', { name: /Parent fee guide/i })).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Search like a coach/i })).toBeNull();
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
        helpRoleFilter: 'parent'
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
        helpRoleFilter: 'parent'
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

  it('preloads a parent registration detail search result before navigation', async () => {
    const onClose = vi.fn();
    searchAppPlayersMock.mockResolvedValueOnce([{
      id: 'registration:team-1:form-1',
      kind: 'player',
      title: 'Spring registration',
      subtitle: 'Rockets',
      route: '/parent-tools/registrations/team-1/form-1',
      teamId: 'team-1',
      playerId: 'form-1',
    }]);

    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="*" element={<AppSearchDialog auth={auth} open={true} onClose={onClose} />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText('Search teams, players, actions, help'), { target: { value: 'spring' } });
    const registrationResult = await screen.findByRole('button', { name: /Spring registration/i });
    fireEvent.click(registrationResult);

    await waitFor(() => {
      expect(preloadSearchRouteMock).toHaveBeenCalledWith('/parent-tools/registrations/team-1/form-1');
    });
    expect(preloadSearchRouteMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith('/parent-tools/registrations/team-1/form-1');
    expect(preloadSearchRouteMock.mock.invocationCallOrder[0]).toBeLessThan(navigateMock.mock.invocationCallOrder[0]);
  });

  it('defers accessible-team hydration until the first meaningful query and reuses it', async () => {
    const onClose = vi.fn();

    render(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={true} onClose={onClose} />
      </MemoryRouter>
    );

    expect(await screen.findAllByRole('button', { name: /Browse Teams/ })).not.toHaveLength(0);
    expect(loadAppSearchTeamsMock).not.toHaveBeenCalled();
    expect(searchAppTeamsMock).not.toHaveBeenCalled();
    expect(searchAppPlayersMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Search teams, players, actions, help'), { target: { value: 'r' } });
    expect(loadAppSearchTeamsMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Search teams, players, actions, help'), { target: { value: 'ro' } });
    await waitFor(() => expect(loadAppSearchTeamsMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(searchAppTeamsMock).toHaveBeenCalledWith('ro', expect.arrayContaining([
      expect.objectContaining({ id: 'team-2', name: 'Rockets' })
    ]), null));
    expect(loadAppSearchTeamsMock).toHaveBeenCalledTimes(1);
  });

  it('shows and consumes the residual cursor instead of reporting capped team search as complete', async () => {
    const cursor = { kind: 'public-team-callable-v2', lastId: 'middle' };
    getKnownAppSearchTeamsMock.mockReturnValue([]);
    loadAppSearchTeamsMock.mockResolvedValue([]);
    searchAppTeamsMock
      .mockResolvedValueOnce({ teams: [], nextCursor: cursor })
      .mockResolvedValueOnce({
        teams: [{ id: 'team-target', name: 'Target United', sport: 'Soccer' }],
        nextCursor: null
      });

    render(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={true} onClose={vi.fn()} />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText('Search teams, players, actions, help'), { target: { value: 'target' } });
    const continueButton = await screen.findByRole('button', { name: 'Continue team search' });
    expect(screen.getByText('No matching teams in this scan yet')).not.toBeNull();
    continueButton.focus();
    fireEvent.keyDown(continueButton, { key: 'Enter' });

    expect(navigateMock).not.toHaveBeenCalled();
    expect(searchAppTeamsMock).toHaveBeenCalledTimes(1);

    fireEvent.click(continueButton);

    await waitFor(() => expect(searchAppTeamsMock).toHaveBeenNthCalledWith(2, 'target', [], null, cursor));
    expect(await screen.findByRole('button', { name: /Target United/i })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue team search' })).toBeNull();
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

  it('coalesces superseded remote player searches while local teams and help keep updating', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const knownTeams: AppSearchTeam[] = [
      { id: 'team-1', name: 'Alphas', sport: 'Basketball', zip: '66210' },
      { id: 'team-2', name: 'Alexandria', sport: 'Soccer', zip: '64114' }
    ];
    getKnownAppSearchTeamsMock.mockReturnValue(knownTeams);
    loadAppSearchTeamsMock.mockResolvedValue(knownTeams);

    render(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={true} onClose={onClose} />
      </MemoryRouter>
    );

    const input = screen.getByLabelText('Search teams, players, actions, help');
    fireEvent.change(input, { target: { value: 'al' } });
    expect(screen.getByRole('button', { name: /Alphas/i })).not.toBeNull();
    expect(screen.getByRole('button', { name: /Alexandria/i })).not.toBeNull();
    expect(screen.getByRole('button', { name: /Parent fee guide/i })).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
      await Promise.resolve();
    });
    expect(searchAppTeamsMock).toHaveBeenCalledWith('al', knownTeams, null);
    expect(searchAppPlayersMock).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'alex' } });
    expect(screen.queryByRole('button', { name: /Alphas/i })).toBeNull();
    expect(screen.getByRole('button', { name: /Alexandria/i })).not.toBeNull();
    expect(screen.getByRole('button', { name: /Parent fee guide/i })).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(360);
      await Promise.resolve();
    });

    expect(searchAppPlayersMock).toHaveBeenCalledTimes(1);
    expect(searchAppPlayersMock).toHaveBeenCalledWith('alex', expect.any(Map), null);
  });

  it('waits for the shortened player coalesce window before running remote player search', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const knownTeams: AppSearchTeam[] = [{ id: 'team-1', name: 'Alexandria', sport: 'Soccer', zip: '64114' }];
    getKnownAppSearchTeamsMock.mockReturnValue(knownTeams);
    loadAppSearchTeamsMock.mockResolvedValue(knownTeams);

    render(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={true} onClose={onClose} />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText('Search teams, players, actions, help'), { target: { value: 'alex' } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
      await Promise.resolve();
    });
    expect(searchAppTeamsMock).toHaveBeenCalledWith('alex', knownTeams, null);
    expect(searchAppPlayersMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
    });

    expect(searchAppPlayersMock).toHaveBeenCalledTimes(1);
    expect(searchAppPlayersMock).toHaveBeenCalledWith('alex', expect.any(Map), null);
  });

  it('cancels a scheduled remote player search when the query is cleared', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const knownTeams: AppSearchTeam[] = [{ id: 'team-1', name: 'Alexandria', sport: 'Soccer', zip: '64114' }];
    getKnownAppSearchTeamsMock.mockReturnValue(knownTeams);
    loadAppSearchTeamsMock.mockResolvedValue(knownTeams);

    render(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={true} onClose={onClose} />
      </MemoryRouter>
    );

    const input = screen.getByLabelText('Search teams, players, actions, help');
    fireEvent.change(input, { target: { value: 'alex' } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
      await Promise.resolve();
    });
    expect(searchAppPlayersMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Clear search query' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
      await Promise.resolve();
    });

    expect(input).toHaveValue('');
    expect(screen.getByText('Type at least 2 characters to search players')).toBeTruthy();
    expect(searchAppPlayersMock).not.toHaveBeenCalled();
  });

  it('cancels a scheduled remote player search when the dialog closes', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const knownTeams: AppSearchTeam[] = [{ id: 'team-1', name: 'Alexandria', sport: 'Soccer', zip: '64114' }];
    getKnownAppSearchTeamsMock.mockReturnValue(knownTeams);
    loadAppSearchTeamsMock.mockResolvedValue(knownTeams);

    const { rerender } = render(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={true} onClose={onClose} />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText('Search teams, players, actions, help'), { target: { value: 'alex' } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
      await Promise.resolve();
    });
    expect(searchAppPlayersMock).not.toHaveBeenCalled();

    rerender(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={false} onClose={onClose} />
      </MemoryRouter>
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
      await Promise.resolve();
    });

    expect(searchAppPlayersMock).not.toHaveBeenCalled();
  });

  it('keeps stale player promises from replacing the latest player results', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const knownTeams: AppSearchTeam[] = [{ id: 'team-1', name: 'Alexandria', sport: 'Soccer', zip: '64114' }];
    let releaseAl!: (players: AppSearchPlayer[]) => void;
    let releaseAlex!: (players: AppSearchPlayer[]) => void;
    const stalePlayer: AppSearchPlayer = {
      id: 'player:team-1:al',
      kind: 'player',
      title: 'Al Older',
      subtitle: 'Alexandria',
      route: '/players/team-1/al',
      teamId: 'team-1',
      playerId: 'al',
    };
    const latestPlayer: AppSearchPlayer = {
      id: 'player:team-1:alex',
      kind: 'player',
      title: 'Alex Latest',
      subtitle: 'Alexandria',
      route: '/players/team-1/alex',
      teamId: 'team-1',
      playerId: 'alex',
    };

    getKnownAppSearchTeamsMock.mockReturnValue(knownTeams);
    loadAppSearchTeamsMock.mockResolvedValue(knownTeams);
    searchAppPlayersMock
      .mockImplementationOnce(() => new Promise((resolve) => {
        releaseAl = resolve;
      }))
      .mockImplementationOnce(() => new Promise((resolve) => {
        releaseAlex = resolve;
      }));

    render(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={true} onClose={onClose} />
      </MemoryRouter>
    );

    const input = screen.getByLabelText('Search teams, players, actions, help');
    fireEvent.change(input, { target: { value: 'al' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(360);
      await Promise.resolve();
    });
    expect(searchAppPlayersMock).toHaveBeenCalledWith('al', expect.any(Map), null);

    fireEvent.change(input, { target: { value: 'alex' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(360);
      await Promise.resolve();
    });
    expect(searchAppPlayersMock).toHaveBeenCalledWith('alex', expect.any(Map), null);

    await act(async () => {
      releaseAlex([latestPlayer]);
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole('button', { name: /Alex Latest/i })).not.toBeNull();

    await act(async () => {
      releaseAl([stalePlayer]);
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole('button', { name: /Alex Latest/i })).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Al Older/i })).toBeNull();
  });

  it('keeps stale initial-scope player results from replacing hydrated-scope results for the same query', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const initialTeams: AppSearchTeam[] = [{ id: 'team-1', name: 'Bears', sport: 'Basketball', zip: '66210' }];
    const hydratedTeams: AppSearchTeam[] = [
      ...initialTeams,
      { id: 'team-2', name: 'Beacons', sport: 'Soccer', zip: '64114' }
    ];
    let releaseHydration!: (teams: AppSearchTeam[]) => void;
    let releaseInitialPlayers!: (players: AppSearchPlayer[]) => void;
    let releaseHydratedPlayers!: (players: AppSearchPlayer[]) => void;

    getKnownAppSearchTeamsMock.mockReturnValue(initialTeams);
    loadAppSearchTeamsMock.mockImplementationOnce(() => new Promise((resolve) => {
      releaseHydration = resolve;
    }));
    searchAppPlayersMock
      .mockImplementationOnce(() => new Promise((resolve) => {
        releaseInitialPlayers = resolve;
      }))
      .mockImplementationOnce(() => new Promise((resolve) => {
        releaseHydratedPlayers = resolve;
      }));

    render(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={true} onClose={onClose} />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText('Search teams, players, actions, help'), { target: { value: 'be' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(550);
      await Promise.resolve();
    });
    expect(searchAppPlayersMock).toHaveBeenCalledTimes(1);
    expect(Array.from(searchAppPlayersMock.mock.calls[0][1].keys())).toEqual(['team-1']);

    await act(async () => {
      releaseHydration(hydratedTeams);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(120);
      await Promise.resolve();
    });
    expect(searchAppPlayersMock).toHaveBeenCalledTimes(2);
    expect(Array.from(searchAppPlayersMock.mock.calls[1][1].keys())).toEqual(['team-1', 'team-2']);

    const hydratedPlayer: AppSearchPlayer = {
      id: 'player:team-2:latest',
      kind: 'player',
      title: 'Beacon Latest',
      subtitle: 'Beacons',
      route: '/players/team-2/latest',
      teamId: 'team-2',
      playerId: 'latest',
    };
    const stalePlayer: AppSearchPlayer = {
      id: 'player:team-1:stale',
      kind: 'player',
      title: 'Bear Stale',
      subtitle: 'Bears',
      route: '/players/team-1/stale',
      teamId: 'team-1',
      playerId: 'stale',
    };

    await act(async () => {
      releaseHydratedPlayers([hydratedPlayer]);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: /Beacon Latest/i })).not.toBeNull();

    await act(async () => {
      releaseInitialPlayers([stalePlayer]);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: /Beacon Latest/i })).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Bear Stale/i })).toBeNull();
  });

  it('ignores stale hydrated teams after the dialog closes before query-time loading finishes', async () => {
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
    fireEvent.change(screen.getByLabelText('Search teams, players, actions, help'), { target: { value: 'ro' } });
    await waitFor(() => expect(loadAppSearchTeamsMock).toHaveBeenCalledTimes(1));

    rerender(
      <MemoryRouter>
        <AppSearchDialog auth={{ ...auth, user: userA }} open={false} onClose={onClose} />
      </MemoryRouter>
    );

    releaseHydration([{ id: 'team-2', name: 'Rockets', sport: 'Soccer', zip: '64114' }]);
    await Promise.resolve();
    expect(screen.queryByRole('button', { name: /Rockets/ })).toBeNull();
    expect(searchAppTeamsMock).not.toHaveBeenCalled();
    expect(searchAppPlayersMock).not.toHaveBeenCalled();
  });

  it('ignores stale hydrated teams after the signed-in user changes', async () => {
    const onClose = vi.fn();
    const userA = { uid: 'user-a', email: 'a@example.com' } as NonNullable<AuthState['user']>;
    const userB = { uid: 'user-b', email: 'b@example.com' } as NonNullable<AuthState['user']>;
    let releaseHydration!: (teams: AppSearchTeam[] | PromiseLike<AppSearchTeam[]>) => void;
    getKnownAppSearchTeamsMock.mockImplementation((user) => user?.uid === userA.uid
      ? [{ id: 'team-a', name: 'Bears', sport: 'Basketball', zip: '66210' }]
      : [{ id: 'team-b', name: 'Tigers', sport: 'Soccer', zip: '64114' }]);
    loadAppSearchTeamsMock.mockImplementationOnce(() => new Promise((resolve) => {
      releaseHydration = resolve;
    }));

    const { rerender } = render(
      <MemoryRouter>
        <AppSearchDialog auth={{ ...auth, user: userA }} open={true} onClose={onClose} />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText('Search teams, players, actions, help'), { target: { value: 'ro' } });
    await waitFor(() => expect(loadAppSearchTeamsMock).toHaveBeenCalledTimes(1));

    rerender(
      <MemoryRouter>
        <AppSearchDialog auth={{ ...auth, user: userB }} open={true} onClose={onClose} />
      </MemoryRouter>
    );

    expect(await screen.findByRole('button', { name: /Tigers/ })).toBeTruthy();
    releaseHydration([{ id: 'team-stale', name: 'Rockets', sport: 'Soccer', zip: '64114' }]);
    await Promise.resolve();

    expect(screen.queryByRole('button', { name: /Rockets/ })).toBeNull();
    expect(searchAppTeamsMock).not.toHaveBeenCalled();
    expect(searchAppPlayersMock).not.toHaveBeenCalled();
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

  it('repeats a provisional search when hydration enriches the same team IDs', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const initialTeams: AppSearchTeam[] = [{ id: 'team-1', name: 'Bears' }];
    const hydratedTeams: AppSearchTeam[] = [{ id: 'team-1', name: 'Bears', sport: 'Soccer', zip: '64114' }];
    let releaseHydration!: (teams: AppSearchTeam[] | PromiseLike<AppSearchTeam[]>) => void;

    getKnownAppSearchTeamsMock.mockReturnValue(initialTeams);
    loadAppSearchTeamsMock.mockImplementationOnce(() => new Promise((resolve) => {
      releaseHydration = resolve;
    }));
    searchAppTeamsMock.mockImplementation(async (query, searchTeams) => {
      const normalizedQuery = query.trim().toLowerCase();
      return searchTeams.filter((team) => [team.name, team.sport, team.zip]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery));
    });

    render(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={true} onClose={onClose} />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText('Search teams, players, actions, help'), { target: { value: 'soccer' } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(430);
      await Promise.resolve();
    });
    expect(searchAppTeamsMock).toHaveBeenCalledTimes(1);
    expect(searchAppTeamsMock).toHaveBeenNthCalledWith(1, 'soccer', initialTeams, null);
    expect(screen.queryByRole('button', { name: /Bears/i })).toBeNull();

    await act(async () => {
      releaseHydration(hydratedTeams);
      await vi.advanceTimersByTimeAsync(50);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(searchAppTeamsMock).toHaveBeenCalledTimes(2);
    expect(searchAppTeamsMock).toHaveBeenNthCalledWith(2, 'soccer', hydratedTeams, null);
    expect(screen.getByRole('button', { name: /Bears/i })).not.toBeNull();
    expect(screen.getByText('Soccer • 64114')).not.toBeNull();
  });

  it('shows provisional local team matches while hydration is pending, then runs a provisional search before hydrating again', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const initialTeams: AppSearchTeam[] = [{ id: 'team-1', name: 'Bears', sport: 'Basketball', zip: '66210' }];
    const hydratedTeams: AppSearchTeam[] = [
      ...initialTeams,
      { id: 'team-2', name: 'Beacons', sport: 'Soccer', zip: '64114' }
    ];
    const hydratedPlayers: AppSearchPlayer[] = [
      {
        id: 'player:team-2:player-2',
        kind: 'player',
        title: '#10 Beacon Kid',
        subtitle: 'Beacons',
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
    searchAppTeamsMock.mockImplementation(async (query, teams) => getImmediateAppTeamSearchResultsMock(query, teams));
    searchAppPlayersMock.mockImplementation(async (_query, teamsById) => teamsById.has('team-2') ? hydratedPlayers : []);

    render(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={true} onClose={onClose} />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText('Search teams, players, actions, help'), { target: { value: 'be' } });

    expect(screen.getByRole('button', { name: /Bears/i })).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(430);
      await Promise.resolve();
    });
    expect(searchAppTeamsMock).toHaveBeenCalledTimes(1);
    expect(searchAppTeamsMock).toHaveBeenNthCalledWith(1, 'be', initialTeams, null);
    expect(searchAppPlayersMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
      await Promise.resolve();
    });
    expect(searchAppPlayersMock).toHaveBeenCalledTimes(1);
    expect(searchAppPlayersMock).toHaveBeenNthCalledWith(1, 'be', expect.any(Map), null);
    expect(Array.from(searchAppPlayersMock.mock.calls[0][1].values())).toEqual(initialTeams);
    expect(screen.queryByRole('button', { name: /Beacons/i })).toBeNull();

    await act(async () => {
      releaseHydration(hydratedTeams);
      await vi.advanceTimersByTimeAsync(50);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(searchAppTeamsMock).toHaveBeenCalledTimes(2);
    expect(searchAppTeamsMock).toHaveBeenNthCalledWith(2, 'be', hydratedTeams, null);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });
    expect(searchAppPlayersMock).toHaveBeenCalledTimes(2);
    expect(searchAppPlayersMock).toHaveBeenNthCalledWith(2, 'be', expect.any(Map), null);
    expect(Array.from(searchAppPlayersMock.mock.calls[1][1].values())).toEqual(hydratedTeams);
    expect(screen.getAllByRole('button', { name: /Beacons/i })).toHaveLength(2);
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
