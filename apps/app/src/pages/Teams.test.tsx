// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Teams } from './Teams';
import type { ParentHomeModel, ParentHomeTeam } from '../lib/homeLogic';
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

function makeTeam(overrides: Partial<ParentHomeTeam> = {}): ParentHomeTeam {
  return {
    teamId: 'team-1',
    teamName: 'Bears',
    role: 'parent',
    sport: 'Basketball',
    photoUrl: null,
    players: [],
    nextEvent: null,
    eventCount: 0,
    unreadCount: 0,
    openActions: 0,
    ...overrides
  };
}

function makeHome(teams: ParentHomeTeam[]): ParentHomeModel {
  return {
    ...emptyHome,
    teams,
    metrics: {
      ...emptyHome.metrics,
      teams: teams.length,
      players: teams.reduce((total, team) => total + team.players.length, 0),
      unreadMessages: teams.reduce((total, team) => total + team.unreadCount, 0)
    }
  };
}

function renderTeams() {
  return render(
    <MemoryRouter initialEntries={["/teams"]}>
      <Routes>
        <Route path="/teams" element={<Teams auth={auth} />} />
        <Route path="/accept-invite" element={<div>Accept invite route</div>} />
      </Routes>
    </MemoryRouter>
  );
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

  it('opens the public browse teams page from the empty state recovery action', async () => {
    renderTeams();

    await screen.findByRole('heading', { name: 'No teams linked yet' });
    const browseLink = screen
      .getAllByRole('link', { name: 'Browse teams' })
      .find((link) => link.getAttribute('href') === 'https://allplays.ai/teams.html');
    expect(browseLink?.getAttribute('href')).toBe('https://allplays.ai/teams.html');
    expect(browseLink).toBeTruthy();
    fireEvent.click(browseLink);

    expect(publicActionMocks.openPublicUrl).toHaveBeenCalledWith('https://allplays.ai/teams.html');
  });

  it('opens a single linked team directly without the chooser or search field', async () => {
    const singleTeamHome = makeHome([makeTeam()]);
    homeServiceMocks.loadParentTeamsSummary.mockResolvedValue(singleTeamHome);
    homeServiceMocks.loadParentHomeSummary.mockResolvedValue(singleTeamHome);

    renderTeams();

    await screen.findByRole('heading', { name: 'Bears' });

    expect(screen.queryByText('Choose a team')).toBeNull();
    expect(screen.queryByPlaceholderText('Search teams or players')).toBeNull();
    expect(screen.getByText('Team hub')).toBeTruthy();
  });

  it('keeps the chooser available when multiple teams are linked', async () => {
    const multiTeamHome = makeHome([
      makeTeam(),
      makeTeam({ teamId: 'team-2', teamName: 'Sharks', role: 'coach', eventCount: 3 })
    ]);
    homeServiceMocks.loadParentTeamsSummary.mockResolvedValue(multiTeamHome);
    homeServiceMocks.loadParentHomeSummary.mockResolvedValue(multiTeamHome);

    renderTeams();

    await screen.findByText('Choose a team');

    expect(screen.getByPlaceholderText('Search teams or players')).toBeTruthy();
    expect(screen.getByText('2 teams')).toBeTruthy();
  });
});
