// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Teams } from './Teams';
import type { AuthState } from '../lib/types';

const homeServiceMocks = vi.hoisted(() => ({
  loadParentHomeSummary: vi.fn(),
  loadParentTeamsSummary: vi.fn()
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

const emptyHome = {
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

function renderTeams({ strictMode = false }: { strictMode?: boolean } = {}) {
  const tree = (
    <MemoryRouter initialEntries={["/teams"]}>
      <Routes>
        <Route path="/teams" element={<Teams auth={auth} />} />
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

function renderTeamsWithNav() {
  return render(
    <MemoryRouter initialEntries={["/teams"]}>
      <Routes>
        <Route path="/teams" element={<Teams auth={auth} />} />
        <Route path="/teams/:teamId" element={<TeamHubRoute />} />
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

describe('Teams empty state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'scrollTo', {
      value: vi.fn(),
      writable: true
    });
    homeServiceMocks.loadParentTeamsSummary.mockResolvedValue(emptyHome);
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

  it('shows retryable blocking error UI instead of the empty state when the first team load fails', async () => {
    homeServiceMocks.loadParentTeamsSummary.mockRejectedValueOnce(new Error('Team service down'));

    renderTeams();

    expect(await screen.findByText('Teams could not load')).toBeTruthy();
    expect(screen.getByText('Try loading teams again to restore your team dashboard.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry loading teams' })).toBeTruthy();
    expect(screen.queryByText('No teams available')).toBeNull();
    expect(screen.queryByText('Loading teams')).toBeNull();
  });

  it('keeps the loading state bound to the latest initial request under StrictMode before showing the retryable error UI', async () => {
    const firstLoad = deferred<typeof emptyHome>();
    const secondLoad = deferred<typeof emptyHome>();
    homeServiceMocks.loadParentTeamsSummary
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
    homeServiceMocks.loadParentTeamsSummary.mockResolvedValue(singleTeamHome);
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

  it('keeps the chooser visible when the only team has no linked players yet', async () => {
    homeServiceMocks.loadParentTeamsSummary.mockResolvedValue({
      ...singleTeamHome,
      teams: [{
        ...singleTeam,
        players: []
      }],
      metrics: { ...singleTeamHome.metrics, players: 0 }
    });
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
