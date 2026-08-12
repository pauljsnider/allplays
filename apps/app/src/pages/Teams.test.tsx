// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Teams } from './Teams';
import type { ParentHomeModel } from '../lib/homeLogic';
import type { AuthState } from '../lib/types';

const homeServiceMocks = vi.hoisted(() => ({
  loadParentHomeSummary: vi.fn(),
  loadParentTeamsSummaryBootstrap: vi.fn()
}));

const publicActionMocks = vi.hoisted(() => ({
  openPublicUrl: vi.fn()
}));

vi.mock('../lib/homeService', () => homeServiceMocks);
vi.mock('../lib/publicActions', () => ({
  openPublicUrl: publicActionMocks.openPublicUrl
}));
vi.mock('../lib/useShellLayout', () => ({
  useShellLayout: () => ({ isDesktopWeb: false })
}));
vi.mock('lucide-react', () => {
  const Icon = () => null;
  return {
    BarChart3: Icon,
    CalendarDays: Icon,
    CheckCircle2: Icon,
    ChevronDown: Icon,
    ChevronRight: Icon,
    ClipboardCheck: Icon,
    ClipboardList: Icon,
    Dumbbell: Icon,
    ExternalLink: Icon,
    FileText: Icon,
    Images: Icon,
    Loader2: Icon,
    MessageCircle: Icon,
    Radio: Icon,
    RefreshCw: Icon,
    Settings: Icon,
    Shield: Icon,
    SlidersHorizontal: Icon,
    Ticket: Icon,
    UserRound: Icon,
    Users: Icon,
    WalletCards: Icon
  };
});

const auth: AuthState = {
  user: {
    uid: 'parent-1',
    email: 'parent@example.com',
    displayName: 'Pat Parent',
    roles: ['parent'],
    parentOf: []
  } as AuthState['user'],
  profile: null,
  loading: false,
  error: null,
  roles: ['parent'],
  isParent: true,
  isCoach: false,
  isAdmin: false,
  isPlatformAdmin: false,
  refresh: vi.fn(),
  signOut: vi.fn()
};

const emptyHome: ParentHomeModel = {
  players: [],
  teams: [],
  upcomingEvents: [],
  actionItems: [],
  fees: [],
  metrics: {
    players: 0,
    teams: 0,
    rsvpNeeded: 0,
    unreadMessages: 0,
    packetsReady: 0
  }
};

function renderTeams({ strictMode = false, initialEntry = '/teams' }: { strictMode?: boolean; initialEntry?: string } = {}) {
  const tree = (
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/teams" element={<Teams auth={auth} />} />
        <Route path="/teams/new" element={<div>Create team route</div>} />
        <Route path="/accept-invite" element={<div>Accept invite route</div>} />
        <Route path="/teams/browse" element={<div>Browse public teams route</div>} />
      </Routes>
    </MemoryRouter>
  );

  return render(strictMode ? <StrictMode>{tree}</StrictMode> : tree);
}

function TeamHubRoute() {
  const { teamId } = useParams<{ teamId: string }>();
  const location = useLocation();
  return <div data-testid="team-hub">Team hub: {teamId}{location.search}</div>;
}

function TeamsLocation() {
  const location = useLocation();
  return <div data-testid="teams-location">{location.pathname}{location.search}</div>;
}

function renderTeamsWithNav(initialEntry = '/teams') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/teams" element={<><Teams auth={auth} /><TeamsLocation /></>} />
        <Route path="/teams/:teamId" element={<TeamHubRoute />} />
        <Route path="/teams/:teamId/fees" element={<div data-testid="team-fees-route">Team fees route</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeTeamSummaryBootstrap(home: ParentHomeModel) {
  return {
    home,
    scheduleScope: {
      profile: { id: 'profile-parent-1' },
      children: home.teams.flatMap((team) => team.players)
    }
  };
}

describe('Teams empty state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'scrollTo', {
      value: vi.fn(),
      writable: true
    });
    homeServiceMocks.loadParentTeamsSummaryBootstrap.mockResolvedValue(makeTeamSummaryBootstrap(emptyHome));
    homeServiceMocks.loadParentHomeSummary.mockResolvedValue(emptyHome);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders a verified streamed team while complete scope discovery is still pending', async () => {
    const completeLoad = deferred<ReturnType<typeof makeTeamSummaryBootstrap>>();
    const streamedHome: ParentHomeModel = {
      ...emptyHome,
      teams: [{
        teamId: 'team-streamed',
        teamName: 'Streamed Stars',
        role: 'Coach',
        sport: null,
        photoUrl: null,
        players: [],
        nextEvent: null,
        eventCount: 0,
        upcomingEventCount: 0,
        unreadCount: 0,
        openActions: 0
      }],
      metrics: { ...emptyHome.metrics, teams: 1 }
    };
    homeServiceMocks.loadParentTeamsSummaryBootstrap.mockImplementationOnce(async (_user, options) => {
      options?.onPartial?.(streamedHome);
      return completeLoad.promise;
    });

    renderTeams();

    expect(await screen.findByRole('link', { name: 'Open Streamed Stars' })).toHaveAttribute(
      'href',
      '/teams/team-streamed'
    );
    expect(screen.queryByText('Loading teams')).toBeNull();

    completeLoad.resolve(makeTeamSummaryBootstrap(streamedHome));
    await waitFor(() => expect(homeServiceMocks.loadParentHomeSummary).toHaveBeenCalledTimes(1));
  });

  it('preserves a streamed team if slower complete scope discovery fails', async () => {
    const streamedHome: ParentHomeModel = {
      ...emptyHome,
      teams: [{
        teamId: 'team-streamed',
        teamName: 'Streamed Stars',
        role: 'Coach',
        sport: null,
        photoUrl: null,
        players: [],
        nextEvent: null,
        eventCount: 0,
        upcomingEventCount: 0,
        unreadCount: 0,
        openActions: 0
      }],
      metrics: { ...emptyHome.metrics, teams: 1 }
    };
    homeServiceMocks.loadParentTeamsSummaryBootstrap.mockImplementationOnce(async (_user, options) => {
      options?.onPartial?.(streamedHome);
      throw new Error('Family scope timed out');
    });

    renderTeams();

    expect(await screen.findByRole('link', { name: 'Open Streamed Stars' })).toBeVisible();
    expect(screen.queryByText('Teams could not load')).toBeNull();
    expect(screen.getByText('Unable to load teams while offline. Check your connection and try again.')).toBeVisible();
  });

  it('merges a streamed refresh slice without erasing the existing chooser when completion fails', async () => {
    const existingHome: ParentHomeModel = {
      ...emptyHome,
      teams: [{
        teamId: 'team-existing',
        teamName: 'Existing Eagles',
        role: 'Parent',
        sport: 'Soccer',
        photoUrl: null,
        players: [{
          teamId: 'team-existing',
          teamName: 'Existing Eagles',
          playerId: 'player-1',
          playerName: 'Alex Eagle'
        }],
        nextEvent: null,
        eventCount: 2,
        upcomingEventCount: 1,
        unreadCount: 1,
        openActions: 1
      }],
      metrics: { ...emptyHome.metrics, teams: 1, players: 1, unreadMessages: 1 }
    };
    const streamedHome: ParentHomeModel = {
      ...emptyHome,
      teams: [{
        teamId: 'team-streamed',
        teamName: 'Streamed Stars',
        role: 'Coach',
        sport: null,
        photoUrl: null,
        players: [],
        nextEvent: null,
        eventCount: 0,
        upcomingEventCount: 0,
        unreadCount: 0,
        openActions: 0
      }],
      metrics: { ...emptyHome.metrics, teams: 1 }
    };
    homeServiceMocks.loadParentTeamsSummaryBootstrap
      .mockResolvedValueOnce(makeTeamSummaryBootstrap(existingHome))
      .mockImplementationOnce(async (_user, options) => {
        options?.onPartial?.(streamedHome);
        throw new Error('Family scope timed out');
      });
    homeServiceMocks.loadParentHomeSummary.mockResolvedValueOnce(existingHome);

    renderTeams();
    expect(await screen.findByRole('link', { name: 'Open Existing Eagles' })).toBeVisible();
    await waitFor(() => expect(homeServiceMocks.loadParentHomeSummary).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Refresh teams' }));

    expect(await screen.findByRole('link', { name: 'Open Streamed Stars' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open Existing Eagles' })).toBeVisible();
    expect(screen.getByText('Alex Eagle')).toBeVisible();
    expect(screen.queryByText('Teams could not load')).toBeNull();
  });

  it('opens the native Browse Teams route from the empty state recovery action', async () => {
    renderTeams();

    await screen.findByRole('heading', { name: 'No teams linked yet' });
    const browseLink = screen.getAllByRole('link', { name: 'Browse teams' })[0];
    expect(browseLink.getAttribute('href')).toBe('/teams/browse');
    fireEvent.click(browseLink);

    expect(await screen.findByText('Browse public teams route')).toBeTruthy();
    expect(publicActionMocks.openPublicUrl).not.toHaveBeenCalled();
  });

  it('opens the native create team route from the empty state primary action', async () => {
    renderTeams();

    await screen.findByRole('heading', { name: 'No teams linked yet' });
    fireEvent.click(screen.getByRole('link', { name: 'Create team' }));

    expect(await screen.findByText('Create team route')).toBeTruthy();
    expect(publicActionMocks.openPublicUrl).not.toHaveBeenCalled();
  });

  it('shows retryable blocking error UI instead of the empty state when the first team load fails', async () => {
    homeServiceMocks.loadParentTeamsSummaryBootstrap.mockRejectedValueOnce(new Error('Team service down'));

    renderTeams();

    expect(await screen.findByText('Teams could not load')).toBeTruthy();
    expect(screen.getByText('Try loading teams again to restore your team dashboard.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry team load' })).toBeTruthy();
    expect(screen.queryByText('No teams available')).toBeNull();
    expect(screen.queryByText('Loading teams')).toBeNull();
  });

  it('keeps the fast team launcher visible when enrichment fails after the initial team summary loads', async () => {
    const fastTeamHome = {
      players: [],
      teams: [{
        teamId: 'team-fast',
        teamName: 'Fast Falcons',
        role: 'Parent' as const,
        sport: 'Basketball',
        photoUrl: null,
        players: [{ teamId: 'team-fast', teamName: 'Fast Falcons', playerId: 'player-1', playerName: 'Avery Ace' }],
        nextEvent: null,
        eventCount: 4,
        upcomingEventCount: 2,
        unreadCount: 1,
        openActions: 0
      }],
      upcomingEvents: [],
      actionItems: [],
      fees: [],
      metrics: { players: 1, teams: 1, rsvpNeeded: 0, unreadMessages: 1, packetsReady: 0 }
    };
    homeServiceMocks.loadParentTeamsSummaryBootstrap.mockResolvedValueOnce(makeTeamSummaryBootstrap(fastTeamHome));
    homeServiceMocks.loadParentHomeSummary.mockRejectedValueOnce(new Error('Enrichment outage'));

    renderTeams({ initialEntry: '/teams?selectedTeamId=team-fast&from=home' });

    expect(await screen.findByRole('heading', { name: '1 team ready' })).toBeTruthy();
    expect(screen.getByText('Choose a team')).toBeTruthy();
    expect(screen.getByText('Unable to refresh teams. Showing the last loaded teams. Try again.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Fast Falcons' }).getAttribute('href')).toBe('/teams/team-fast');
    expect(screen.queryByText('Teams could not load')).toBeNull();
    expect(screen.queryByText('No teams available')).toBeNull();
  });

  it('does not let a nonempty enrichment subset erase an authoritative fast team', async () => {
    const authoritativeTeam = {
      teamId: 'team-authoritative', teamName: 'Authoritative Aces', role: 'Coach' as const, sport: 'Soccer', photoUrl: null,
      players: [], nextEvent: null, eventCount: 0, upcomingEventCount: 0, unreadCount: 0, openActions: 0
    };
    const otherTeam = {
      teamId: 'team-other', teamName: 'Other Owls', role: 'Coach' as const, sport: 'Soccer', photoUrl: null,
      players: [], nextEvent: null, eventCount: 0, upcomingEventCount: 0, unreadCount: 0, openActions: 0
    };
    const fastHome = {
      ...emptyHome,
      teams: [authoritativeTeam, otherTeam],
      metrics: { ...emptyHome.metrics, teams: 2 }
    };
    const incompleteEnrichment = {
      ...emptyHome,
      teams: [{ ...otherTeam, eventCount: 2 }],
      metrics: { ...emptyHome.metrics, teams: 1 }
    };
    homeServiceMocks.loadParentTeamsSummaryBootstrap.mockResolvedValueOnce(makeTeamSummaryBootstrap(fastHome));
    homeServiceMocks.loadParentHomeSummary.mockResolvedValueOnce(incompleteEnrichment);

    renderTeams();

    expect(await screen.findByRole('link', { name: 'Open Authoritative Aces' })).toBeTruthy();
    await waitFor(() => expect(homeServiceMocks.loadParentHomeSummary).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('link', { name: 'Open Authoritative Aces' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Other Owls' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '2 teams ready' })).toBeTruthy();
  });

  it('preserves the complete team chooser when a refresh returns incomplete access', async () => {
    const completeHome = {
      players: [],
      teams: [
        {
          teamId: 'team-1', teamName: 'Vipers', role: 'Coach' as const, sport: 'Soccer', photoUrl: null,
          players: [], nextEvent: null, eventCount: 0, upcomingEventCount: 0, unreadCount: 0, openActions: 0
        },
        {
          teamId: 'team-2', teamName: 'Current', role: 'Coach' as const, sport: 'Soccer', photoUrl: null,
          players: [], nextEvent: null, eventCount: 0, upcomingEventCount: 0, unreadCount: 0, openActions: 0
        }
      ],
      upcomingEvents: [],
      actionItems: [],
      fees: [],
      metrics: { players: 0, teams: 2, rsvpNeeded: 0, unreadMessages: 0, packetsReady: 0 }
    };
    homeServiceMocks.loadParentTeamsSummaryBootstrap
      .mockResolvedValueOnce(makeTeamSummaryBootstrap(completeHome))
      .mockRejectedValueOnce(new Error('Team access discovery is incomplete'));
    homeServiceMocks.loadParentHomeSummary.mockResolvedValueOnce(completeHome);

    renderTeams();

    expect(await screen.findByRole('heading', { name: '2 teams ready' })).toBeTruthy();
    await waitFor(() => expect(homeServiceMocks.loadParentHomeSummary).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh teams' }));

    expect(await screen.findByText('Unable to refresh teams. Showing the last loaded teams. Try again.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Vipers' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Current' })).toBeTruthy();
    expect(screen.queryByText('No teams linked yet')).toBeNull();
  });

  it('reuses the fast summary scope when loading the enriched team cards', async () => {
    const fastTeamHome = {
      players: [],
      teams: [{
        teamId: 'team-fast',
        teamName: 'Fast Falcons',
        role: 'Parent' as const,
        sport: 'Basketball',
        photoUrl: null,
        players: [{ teamId: 'team-fast', teamName: 'Fast Falcons', playerId: 'player-1', playerName: 'Avery Ace' }],
        nextEvent: null,
        eventCount: 3,
        upcomingEventCount: 0,
        unreadCount: 1,
        openActions: 0
      }],
      upcomingEvents: [],
      actionItems: [],
      fees: [],
      metrics: { players: 1, teams: 1, rsvpNeeded: 0, unreadMessages: 1, packetsReady: 0 }
    };
    const scheduleScope = {
      profile: { id: 'profile-parent-1' },
      children: fastTeamHome.teams[0].players
    };
    homeServiceMocks.loadParentTeamsSummaryBootstrap.mockResolvedValueOnce({
      home: fastTeamHome,
      scheduleScope
    });
    homeServiceMocks.loadParentHomeSummary.mockResolvedValueOnce({
      ...fastTeamHome,
      teams: [{
        ...fastTeamHome.teams[0],
        eventCount: 2,
        upcomingEventCount: 2
      }]
    });

    renderTeams({ initialEntry: '/teams?selectedTeamId=team-fast' });

    expect(await screen.findByRole('heading', { name: '1 team ready' })).toBeTruthy();
    await waitFor(() => {
      expect(homeServiceMocks.loadParentHomeSummary).toHaveBeenCalledWith(auth.user, {
        force: false,
        scheduleScope
      });
    });
    expect(homeServiceMocks.loadParentTeamsSummaryBootstrap).toHaveBeenCalledTimes(1);
  });

  it('keeps the loading state bound to the latest initial request under StrictMode before showing the retryable error UI', async () => {
    const firstLoad = deferred<ReturnType<typeof makeTeamSummaryBootstrap>>();
    const secondLoad = deferred<ReturnType<typeof makeTeamSummaryBootstrap>>();
    homeServiceMocks.loadParentTeamsSummaryBootstrap
      .mockImplementationOnce(() => firstLoad.promise)
      .mockImplementationOnce(() => secondLoad.promise);

    renderTeams({ strictMode: true });

    expect(await screen.findByText('Loading teams')).toBeTruthy();

    firstLoad.reject(new Error('First request failed'));
    await waitFor(() => {
      expect(screen.getByText('Loading teams')).toBeTruthy();
    });

    secondLoad.reject(new Error('Second request failed'));

    expect(await screen.findByText('Teams could not load')).toBeTruthy();
    expect(screen.getByText('Try loading teams again to restore your team dashboard.')).toBeTruthy();
    expect(screen.queryByText('Loading teams')).toBeNull();
  });
});

describe('Teams launcher navigation', () => {
  const twoTeamHome = {
    players: [],
    teams: [
      {
        teamId: 'team-fast',
        teamName: 'Fast Falcons',
        role: 'Parent' as const,
        sport: 'Basketball',
        photoUrl: null,
        players: [{ teamId: 'team-fast', teamName: 'Fast Falcons', playerId: 'player-1', playerName: 'Avery Ace' }],
        nextEvent: null,
        eventCount: 4,
        upcomingEventCount: 2,
        unreadCount: 1,
        openActions: 0
      },
      {
        teamId: 'team-slow',
        teamName: 'Slow Sharks',
        role: 'Coach' as const,
        sport: 'Soccer',
        photoUrl: null,
        players: [],
        nextEvent: null,
        eventCount: 3,
        upcomingEventCount: 0,
        unreadCount: 0,
        openActions: 0
      }
    ],
    upcomingEvents: [],
    actionItems: [],
    fees: [],
    metrics: { players: 1, teams: 2, rsvpNeeded: 0, unreadMessages: 1, packetsReady: 0 }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true });
    homeServiceMocks.loadParentTeamsSummaryBootstrap.mockResolvedValue(makeTeamSummaryBootstrap(twoTeamHome));
    homeServiceMocks.loadParentHomeSummary.mockResolvedValue(twoTeamHome);
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps one team-page action per launcher row', async () => {
    renderTeamsWithNav();

    const fastFalcons = await screen.findByRole('link', { name: 'Open Fast Falcons' });
    const slowSharks = screen.getByRole('link', { name: 'Open Slow Sharks' });
    expect(fastFalcons.getAttribute('href')).toBe('/teams/team-fast');
    expect(slowSharks.getAttribute('href')).toBe('/teams/team-slow');
    expect(fastFalcons.getAttribute('title')).toBe('Open Fast Falcons');
    expect(slowSharks.getAttribute('title')).toBe('Open Slow Sharks');
    expect(fastFalcons.hasAttribute('aria-describedby')).toBe(false);
    expect(slowSharks.hasAttribute('aria-describedby')).toBe(false);
    expect(screen.getByText('Choose a team to open its page and tools.')).toBeTruthy();

    const fastFalconsRow = fastFalcons.closest<HTMLElement>('.team-launcher-row');
    const slowSharksRow = slowSharks.closest<HTMLElement>('.team-launcher-row');
    expect(fastFalconsRow).not.toBeNull();
    expect(slowSharksRow).not.toBeNull();
    expect(within(fastFalconsRow!).getAllByRole('link')).toEqual([fastFalcons]);
    expect(within(slowSharksRow!).getAllByRole('link')).toEqual([slowSharks]);
    expect(screen.queryByRole('link', { name: 'Fast Falcons messages' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Fast Falcons schedule' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Fast Falcons team hub' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Slow Sharks messages' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Slow Sharks schedule' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Slow Sharks team hub' })).toBeNull();

    expect(screen.queryByRole('link', { name: 'Chat' })).toBeNull();
    expect(screen.queryByRole('link', { name: /^Schedule/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /^Messages/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /^Practice packets/ })).toBeNull();

    fireEvent.click(fastFalcons);

    expect((await screen.findByTestId('team-hub')).textContent).toBe('Team hub: team-fast');
  });

  it('keeps team stats informational on launcher rows', async () => {
    renderTeamsWithNav();

    await screen.findByRole('heading', { name: '2 teams ready' });
    const fastFalcons = screen.getByRole('link', { name: 'Open Fast Falcons' });
    const selectedRow = fastFalcons.closest('article');
    expect(selectedRow).not.toBeNull();

    expect(within(selectedRow!).getByText('1 player')).toBeTruthy();
    expect(within(selectedRow!).getByText('2 upcoming')).toBeTruthy();
    expect(within(selectedRow!).getByText('1 unread')).toBeTruthy();
    expect(within(selectedRow!).getAllByRole('link')).toEqual([fastFalcons]);
    expect(within(screen.getByRole('link', { name: 'Open Slow Sharks' }).closest('article')!).getByText('0 upcoming')).toBeTruthy();
  });
});

describe('Teams single-team navigation', () => {
  const singleTeam = {
    teamId: 'team-solo',
    teamName: 'Solo Bears',
    role: 'Parent' as const,
    sport: 'Basketball',
    photoUrl: null,
    players: [{ teamId: 'team-solo', teamName: 'Solo Bears', playerId: 'player-1', playerName: 'Alex Star' }],
    nextEvent: null,
    eventCount: 3,
    upcomingEventCount: 3,
    unreadCount: 0,
    openActions: 0
  };

  const singleTeamHome = {
    players: [],
    teams: [singleTeam],
    upcomingEvents: [],
    actionItems: [],
    fees: [],
    metrics: { players: 1, teams: 1, rsvpNeeded: 0, unreadMessages: 0, packetsReady: 0 }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true });
    homeServiceMocks.loadParentTeamsSummaryBootstrap.mockResolvedValue(makeTeamSummaryBootstrap(singleTeamHome));
    homeServiceMocks.loadParentHomeSummary.mockResolvedValue(singleTeamHome);
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps the My Teams chooser open when the initial load contains one linked team', async () => {
    renderTeamsWithNav();

    expect(await screen.findByRole('heading', { name: '1 team ready' })).toBeTruthy();
    expect(screen.getByText('Choose a team')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Solo Bears' })).toHaveAttribute('href', '/teams/team-solo');
    expect(screen.queryByTestId('team-hub')).toBeNull();
    expect(screen.queryByText('Loading teams')).toBeNull();
  });

  it('opens team fees directly when the fees workflow targets a single linked team', async () => {
    renderTeamsWithNav('/teams?workflow=fees');

    await waitFor(() => {
      expect(screen.getByTestId('team-fees-route')).toBeTruthy();
    });

    expect(screen.queryByTestId('team-hub')).toBeNull();
    expect(screen.queryByText('Choose a team')).toBeNull();
  });

  it('opens the roster tab directly when the roster workflow targets a single linked team', async () => {
    renderTeamsWithNav('/teams?workflow=roster');

    await waitFor(() => {
      expect(screen.getByTestId('team-hub')).toHaveTextContent('Team hub: team-solo?tab=roster');
    });

    expect(screen.queryByText('Choose a team')).toBeNull();
  });

  it('keeps the chooser open when the only loaded team has no linked players yet', async () => {
    homeServiceMocks.loadParentTeamsSummaryBootstrap.mockResolvedValue(makeTeamSummaryBootstrap({
      ...singleTeamHome,
      teams: [{
        ...singleTeam,
        players: []
      }],
      metrics: { ...singleTeamHome.metrics, players: 0 }
    }));
    homeServiceMocks.loadParentHomeSummary.mockResolvedValue({
      ...singleTeamHome,
      teams: [{
        ...singleTeam,
        players: []
      }],
      metrics: { ...singleTeamHome.metrics, players: 0 }
    });

    renderTeamsWithNav();

    expect(await screen.findByRole('heading', { name: '1 team ready' })).toBeTruthy();
    expect(screen.getByText('Choose a team')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Solo Bears' })).toHaveAttribute('href', '/teams/team-solo');
    expect(screen.queryByTestId('team-hub')).toBeNull();
  });
});
