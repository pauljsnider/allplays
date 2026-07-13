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
  return <div data-testid="team-hub">Team hub: {teamId}</div>;
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

  it('opens the native Browse Teams route from the empty state recovery action', async () => {
    renderTeams();

    await screen.findByRole('heading', { name: 'No teams linked yet' });
    const browseLink = screen.getAllByRole('link', { name: 'Browse teams' })[0];
    expect(browseLink).toHaveAttribute('href', '/teams/browse');
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
        eventCount: 2,
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

    expect(await screen.findByRole('heading', { name: '1 team ready' })).toBeInTheDocument();
    expect(screen.getByText('Choose a team')).toBeInTheDocument();
    expect(screen.getByText('Unable to refresh teams. Showing the last loaded teams. Try again.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Fast Falcons' })).toHaveAttribute('href', '/teams/team-fast');
    expect(screen.queryByText('Teams could not load')).toBeNull();
    expect(screen.queryByText('No teams available')).toBeNull();
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
        eventCount: 0,
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
        eventCount: 2
      }]
    });

    renderTeams({ initialEntry: '/teams?selectedTeamId=team-fast' });

    expect(await screen.findByRole('heading', { name: '1 team ready' })).toBeInTheDocument();
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
        eventCount: 2,
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
        eventCount: 0,
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

  it('keeps one team-hub action per launcher row while selected-team tools remain available', async () => {
    renderTeamsWithNav();

    const fastFalcons = await screen.findByRole('link', { name: 'Open Fast Falcons' });
    const slowSharks = screen.getByRole('link', { name: 'Open Slow Sharks' });
    expect(fastFalcons).toHaveAttribute('href', '/teams/team-fast');
    expect(slowSharks).toHaveAttribute('href', '/teams/team-slow');
    expect(fastFalcons).toHaveAttribute('title', 'Open Fast Falcons');
    expect(slowSharks).toHaveAttribute('title', 'Open Slow Sharks');
    expect(fastFalcons).toHaveAttribute('aria-describedby', 'selected-team-team-fast');
    expect(slowSharks).not.toHaveAttribute('aria-describedby');
    expect(screen.getByText('Open a team hub to use its tools.')).toBeInTheDocument();

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

    expect(screen.getByRole('link', { name: 'Chat' })).toHaveAttribute('href', '/messages/team-fast');
    expect(screen.getByRole('link', { name: /^Schedule/ })).toHaveAttribute('href', '/schedule?teamId=team-fast');
    expect(screen.getByRole('link', { name: /^Messages/ })).toHaveAttribute('href', '/messages/team-fast');
    expect(screen.getByRole('link', { name: /^Practice packets/ })).toHaveAttribute('href', '/schedule?teamId=team-fast&view=packets');

    fireEvent.click(fastFalcons);

    expect(await screen.findByTestId('team-hub')).toHaveTextContent('Team hub: team-fast');
  });
});

describe('Teams single-team auto-navigate', () => {
  const singleTeam = {
    teamId: 'team-solo',
    teamName: 'Solo Bears',
    role: 'Parent' as const,
    sport: 'Basketball',
    photoUrl: null,
    players: [{ teamId: 'team-solo', teamName: 'Solo Bears', playerId: 'player-1', playerName: 'Alex Star' }],
    nextEvent: null,
    eventCount: 3,
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

  it('navigates directly to the team hub without showing the chooser when the user has exactly one linked player on one team', async () => {
    renderTeamsWithNav();

    await waitFor(() => {
      expect(screen.getByTestId('team-hub')).toBeInTheDocument();
    });

    expect(screen.getByTestId('team-hub').textContent).toBe('Team hub: team-solo');
    expect(screen.queryByText('Choose a team')).toBeNull();
    expect(screen.queryByText('Loading teams')).toBeNull();
  });

  it('opens team fees directly when the fees workflow targets a single linked team', async () => {
    renderTeamsWithNav('/teams?workflow=fees');

    await waitFor(() => {
      expect(screen.getByTestId('team-fees-route')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('team-hub')).toBeNull();
    expect(screen.queryByText('Choose a team')).toBeNull();
  });

  it('keeps the chooser visible when the only team has no linked players yet', async () => {
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

    expect(await screen.findByRole('heading', { name: '1 team ready' })).toBeInTheDocument();
    expect(screen.getByText('Choose a team')).toBeInTheDocument();
    expect(screen.queryByTestId('team-hub')).toBeNull();
  });
});
