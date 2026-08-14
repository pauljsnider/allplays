// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Home } from './Home';
import type { AuthState } from '../lib/types';

const homeServiceMocks = vi.hoisted(() => ({
  loadParentHomeSummaryBootstrap: vi.fn(),
  loadParentHomeWithSecondaryData: vi.fn()
}));

const socialServiceMocks = vi.hoisted(() => ({
  blockFriend: vi.fn(),
  commentOnSocialPost: vi.fn(),
  createSocialPost: vi.fn(),
  discardSocialPostMediaUpload: vi.fn(),
  hideSocialPost: vi.fn(),
  loadSocialHome: vi.fn(),
  removeFriend: vi.fn(),
  reportSocialPost: vi.fn(),
  respondToFriendRequest: vi.fn(),
  searchSocialUsers: vi.fn(),
  sendFriendRequest: vi.fn(),
  reactToSocialPost: vi.fn(),
  uploadSocialPostMedia: vi.fn()
}));

const scheduleServiceMocks = vi.hoisted(() => ({
  loadOfficialAssignmentsAccess: vi.fn()
}));

const opportunityServiceMocks = vi.hoisted(() => ({
  listPublicOpportunities: vi.fn()
}));

const uxTimingMocks = vi.hoisted(() => ({
  recordFirstMeaningfulRender: vi.fn(),
  startScreenMountTimer: vi.fn(() => ({ end: vi.fn() })),
  startUxTimer: vi.fn(() => ({ end: vi.fn(), cancel: vi.fn() }))
}));

vi.mock('../components/PageSkeletons', () => ({
  HomePageSkeleton: () => <div>Loading Home</div>
}));
vi.mock('../lib/homeService', () => homeServiceMocks);
vi.mock('../lib/socialService', () => socialServiceMocks);
vi.mock('../lib/scheduleService', () => scheduleServiceMocks);
vi.mock('../lib/opportunityService', () => opportunityServiceMocks);
vi.mock('../lib/uxTiming', () => uxTimingMocks);
vi.mock('lucide-react', () => {
  const Icon = () => null;
  return {
    AlertCircle: Icon,
    BriefcaseBusiness: Icon,
    CalendarDays: Icon,
    Car: Icon,
    CheckCircle2: Icon,
    ChevronRight: Icon,
    ClipboardCheck: Icon,
    DollarSign: Icon,
    Flag: Icon,
    Heart: Icon,
    ImagePlus: Icon,
    Loader2: Icon,
    MessageCircle: Icon,
    Newspaper: Icon,
    Plus: Icon,
    RefreshCw: Icon,
    Share2: Icon,
    Shield: Icon,
    Sparkles: Icon,
    Ticket: Icon,
    Trophy: Icon,
    UserRound: Icon,
    UserPlus: Icon,
    Users: Icon
  };
});

const baseHome = {
  players: [
    {
      teamId: 'team-1',
      teamName: 'Bears',
      playerId: 'player-1',
      playerName: 'Pat Player',
      nextEvent: null,
      rsvpNeeded: 0,
      packetsReady: 0,
      openAssignments: 0,
      unreadCount: 0
    }
  ],
  teams: [
    {
      teamId: 'team-1',
      teamName: 'Bears',
      role: 'Parent',
      sport: 'Basketball',
      players: [
        {
          teamId: 'team-1',
          teamName: 'Bears',
          playerId: 'player-1',
          playerName: 'Pat Player'
        }
      ],
      nextEvent: null,
      eventCount: 0,
      unreadCount: 0,
      openActions: 0
    }
  ],
  upcomingEvents: [],
  actionItems: [],
  fees: [],
  metrics: {
    players: 1,
    teams: 1,
    rsvpNeeded: 0,
    unreadMessages: 0,
    packetsReady: 0
  }
};

const baseFeedItem = {
  id: 'post-1',
  type: 'player_moment',
  visibility: 'friends',
  authorId: 'friend-1',
  authorName: 'Jamie Friend',
  authorPhotoUrl: null,
  teamId: 'team-1',
  teamName: 'Bears',
  playerIds: ['player-1'],
  playerNames: ['Pat Player'],
  sourceType: 'player',
  sourceId: 'player-1',
  title: 'Pat Player highlight',
  detail: 'Player moment · Pat Player · Bears',
  caption: 'Great effort today.',
  media: [],
  route: '/players/team-1/player-1',
  createdAt: new Date('2100-06-01T18:00:00Z'),
  reactionCounts: { like: 2 },
  commentCount: 1
};

const baseSocial = {
  feedItems: [],
  friends: [],
  incomingRequests: [],
  outgoingRequests: [],
  suggestions: [],
  friendshipsError: null,
  feedError: null,
  metrics: {
    feedItems: 0,
    friends: 0,
    incomingRequests: 0,
    suggestions: 0
  }
};

const emptyHome = {
  ...baseHome,
  players: [],
  teams: [],
  metrics: {
    ...baseHome.metrics,
    players: 0,
    teams: 0
  }
};

function buildSwitchableComposerHome() {
  const secondPlayer = {
    teamId: 'team-2',
    teamName: 'Storm',
    playerId: 'player-2',
    playerName: 'Sam Player',
    nextEvent: null,
    rsvpNeeded: 0,
    packetsReady: 0,
    openAssignments: 0,
    unreadCount: 0
  };
  const secondTeam = {
    teamId: 'team-2',
    teamName: 'Storm',
    role: 'Parent',
    sport: 'Soccer',
    players: [{
      teamId: 'team-2',
      teamName: 'Storm',
      playerId: 'player-2',
      playerName: 'Sam Player'
    }],
    nextEvent: null,
    eventCount: 1,
    unreadCount: 0,
    openActions: 0
  };
  const game = (id: string, opponent: string, date: string) => ({
    eventKey: `team-1::${id}::player-1`,
    id,
    teamId: 'team-1',
    teamName: 'Bears',
    type: 'game',
    date: new Date(date),
    location: 'Main Gym',
    opponent,
    title: null,
    childId: 'player-1',
    childName: 'Pat Player',
    isDbGame: true,
    isCancelled: false,
    status: id === 'game-3' ? 'scheduled' : 'completed',
    myRsvp: 'going',
    assignments: []
  });
  return {
    ...baseHome,
    players: [...baseHome.players, secondPlayer],
    teams: [...baseHome.teams, secondTeam],
    feedGames: [
      game('game-1', 'Falcons', '2026-07-10T18:00:00Z'),
      game('game-2', 'Rockets', '2026-07-11T18:00:00Z'),
      game('game-3', 'Owls', '2026-08-09T18:00:00Z')
    ],
    metrics: { ...baseHome.metrics, players: 2, teams: 2 }
  };
}

function buildLargeHomeModel() {
  return {
    players: Array.from({ length: 4 }, (_, index) => ({
      teamId: index < 2 ? 'team-1' : index === 2 ? 'team-2' : 'team-3',
      teamName: index < 2 ? 'Bears' : index === 2 ? 'Storm' : 'Falcons',
      playerId: `player-${index + 1}`,
      playerName: `Player ${index + 1}`,
      nextEvent: {
        teamId: index < 2 ? 'team-1' : index === 2 ? 'team-2' : 'team-3',
        id: `event-${index + 1}`,
        childId: `player-${index + 1}`,
        childName: `Player ${index + 1}`,
        teamName: index < 2 ? 'Bears' : index === 2 ? 'Storm' : 'Falcons',
        type: 'game',
        date: new Date(`2100-06-0${index + 1}T18:00:00Z`),
        location: 'Main Gym',
        opponent: 'Rivals',
        title: null,
        eventKey: `team-${index + 1}::event-${index + 1}::player-${index + 1}`,
        isDbGame: true,
        isCancelled: false,
        myRsvp: 'not_responded',
        assignments: []
      },
      rsvpNeeded: index < 2 ? 1 : 0,
      packetsReady: index === 2 ? 1 : 0,
      openAssignments: index === 3 ? 2 : 0,
      unreadCount: index < 2 ? 3 : 0
    })),
    teams: [
      {
        teamId: 'team-1',
        teamName: 'Bears',
        role: 'Parent',
        sport: 'Basketball',
        players: [
          { teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Player 1' },
          { teamId: 'team-1', teamName: 'Bears', playerId: 'player-2', playerName: 'Player 2' }
        ],
        nextEvent: null,
        eventCount: 4,
        unreadCount: 3,
        openActions: 5
      },
      {
        teamId: 'team-2',
        teamName: 'Storm',
        role: 'Parent',
        sport: 'Soccer',
        players: [
          { teamId: 'team-2', teamName: 'Storm', playerId: 'player-3', playerName: 'Player 3' }
        ],
        nextEvent: null,
        eventCount: 2,
        unreadCount: 0,
        openActions: 2
      },
      {
        teamId: 'team-3',
        teamName: 'Falcons',
        role: 'Parent',
        sport: 'Volleyball',
        players: [
          { teamId: 'team-3', teamName: 'Falcons', playerId: 'player-4', playerName: 'Player 4' }
        ],
        nextEvent: null,
        eventCount: 3,
        unreadCount: 1,
        openActions: 3
      }
    ],
    upcomingEvents: Array.from({ length: 6 }, (_, index) => ({
      teamId: index < 3 ? 'team-1' : index < 5 ? 'team-2' : 'team-3',
      id: `upcoming-${index + 1}`,
      childId: `player-${(index % 4) + 1}`,
      childName: `Player ${(index % 4) + 1}`,
      teamName: index < 3 ? 'Bears' : index < 5 ? 'Storm' : 'Falcons',
      type: index % 2 === 0 ? 'game' : 'practice',
      date: new Date(`2100-06-${String(index + 1).padStart(2, '0')}T18:00:00Z`),
      location: 'Main Gym',
      opponent: 'Rivals',
      title: index % 2 === 0 ? null : 'Practice',
      eventKey: `team-${index + 1}::upcoming-${index + 1}::player-${(index % 4) + 1}`,
      isDbGame: true,
      isCancelled: false,
      myRsvp: 'going',
      assignments: []
    })),
    actionItems: [
      { id: 'rsvp:1', kind: 'rsvp', tone: 'amber', title: 'Player 1 needs availability', detail: 'Bears Game · Tue, Jun 1', to: '/schedule/team-1/upcoming-1', priority: 10, date: new Date('2100-06-01T18:00:00Z') },
      { id: 'packet:1', kind: 'packet', tone: 'blue', title: 'Practice packet ready', detail: 'Player 3 · Skills packet', to: '/schedule/team-2/upcoming-4', priority: 20, date: new Date('2100-06-04T18:00:00Z') },
      { id: 'assignment:1', kind: 'assignment', tone: 'emerald', title: '2 open assignments', detail: 'Falcons Game · Clock, Book', to: '/schedule/team-3/upcoming-6', priority: 30, date: new Date('2100-06-06T18:00:00Z') },
      { id: 'fee:1', kind: 'fee', tone: 'rose', title: 'Tournament fee', detail: 'Bears · Player 2 · $20.00 due', to: '/parent-tools/fees', priority: 50, date: new Date('2100-06-02T18:00:00Z') },
      { id: 'message:1', kind: 'message', tone: 'blue', title: '3 unread messages', detail: 'Bears', to: '/messages/team-1', priority: 60, date: null },
      { id: 'message:2', kind: 'message', tone: 'blue', title: '1 unread message', detail: 'Falcons', to: '/messages/team-3', priority: 60, date: null }
    ],
    fees: [
      { id: 'fee-1', title: 'Tournament fee', teamId: 'team-1', teamName: 'Bears', playerName: 'Player 2', status: 'partial', balanceDueCents: 2000 }
    ],
    metrics: {
      players: 4,
      teams: 3,
      rsvpNeeded: 2,
      unreadMessages: 4,
      packetsReady: 1
    }
  };
}

function buildHomeWithRsvpNeeded(rsvpNeeded: number) {
  const rsvpAction = {
    id: 'rsvp:single',
    kind: 'rsvp',
    tone: 'amber',
    title: 'Pat Player needs availability',
    detail: 'Bears Game · Tue, Jun 1',
    to: '/schedule/team-1/game-1',
    priority: 10,
    date: new Date('2100-06-01T18:00:00Z')
  };
  return {
    ...baseHome,
    players: baseHome.players.map((player) => ({ ...player, rsvpNeeded })),
    actionItems: rsvpNeeded > 0 ? [rsvpAction] : [],
    metrics: { ...baseHome.metrics, rsvpNeeded }
  };
}

const signedInAuth: AuthState = {
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

const signedOutAuth: AuthState = {
  ...signedInAuth,
  user: null,
  roles: [],
  isParent: false
};

const secondSignedInAuth: AuthState = {
  ...signedInAuth,
  user: {
    ...signedInAuth.user!,
    uid: 'parent-2',
    email: 'second-parent@example.com',
    displayName: 'Second Parent'
  } as AuthState['user']
};

function renderHome(auth: AuthState, initialEntry = '/home') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/home" element={<Home auth={auth} />} />
        <Route path="/teams/:teamId" element={<div>Team route</div>} />
        <Route path="/messages" element={<div>Messages route</div>} />
        <Route path="/schedule" element={<div>Schedule route</div>} />
        <Route path="/officials" element={<div>Officials route</div>} />
        <Route path="/ai" element={<div>AI route</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Home', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'scrollTo', {
      value: vi.fn(),
      writable: true
    });
    homeServiceMocks.loadParentHomeSummaryBootstrap.mockResolvedValue({ home: baseHome, schedule: [] });
    homeServiceMocks.loadParentHomeWithSecondaryData.mockResolvedValue(baseHome);
    socialServiceMocks.loadSocialHome.mockResolvedValue(baseSocial);
    socialServiceMocks.discardSocialPostMediaUpload.mockResolvedValue(undefined);
    socialServiceMocks.uploadSocialPostMedia.mockResolvedValue({
      type: 'image',
      url: 'https://primary.example/social.jpg',
      name: 'social.jpg',
      thumbnailUrl: null,
      storagePath: 'stat-sheets/team-chat/team-1/team/parent-1/social.jpg'
    });
    scheduleServiceMocks.loadOfficialAssignmentsAccess.mockResolvedValue({ hasAccess: false, teamCount: 0, isPartial: false });
    opportunityServiceMocks.listPublicOpportunities.mockResolvedValue({ items: [], nextCursor: null });
  });

  afterEach(() => {
    cleanup();
  });

  it('records first meaningful render when the Home summary is available', async () => {
    let resolveBootstrap!: (value: { home: typeof baseHome; schedule: [] }) => void;
    let resolveSecondary!: (value: typeof baseHome) => void;
    homeServiceMocks.loadParentHomeSummaryBootstrap.mockImplementationOnce(() => new Promise((resolve) => {
      resolveBootstrap = resolve;
    }));
    homeServiceMocks.loadParentHomeWithSecondaryData.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSecondary = resolve;
    }));

    renderHome(signedInAuth);

    expect(uxTimingMocks.recordFirstMeaningfulRender).not.toHaveBeenCalled();

    resolveBootstrap({ home: baseHome, schedule: [] });

    expect(await screen.findByRole('heading', { name: 'Your day' })).toBeTruthy();
    await waitFor(() => {
      expect(uxTimingMocks.recordFirstMeaningfulRender).toHaveBeenCalledWith('home');
    });

    resolveSecondary(baseHome);
    expect(uxTimingMocks.recordFirstMeaningfulRender).toHaveBeenCalledTimes(1);
  });

  it('renders a progressive Home preview while the full schedule summary is still pending', async () => {
    homeServiceMocks.loadParentHomeSummaryBootstrap.mockImplementationOnce((_user: unknown, options: any) => {
      options?.onPartial?.({ home: baseHome, schedule: { children: [], events: [], isPartial: true } });
      return new Promise(() => {});
    });

    renderHome(signedInAuth);

    expect(await screen.findByRole('heading', { name: 'Your day' })).toBeTruthy();
    expect(screen.getByText('Checking responses…')).toBeTruthy();
    expect(screen.queryByText('Loading Home')).toBeNull();
    expect(uxTimingMocks.recordFirstMeaningfulRender).toHaveBeenCalledWith('home');
  });

  it('renders a dedicated welcome instead of personalized Home for signed-out users', async () => {
    renderHome(signedOutAuth, '/home?section=feed');

    expect(await screen.findByRole('heading', { name: 'Your sports day, organized' })).toBeTruthy();
    const createAccountLink = screen.getByRole('link', { name: /Create account/i });
    expect(createAccountLink.getAttribute('href')).toBe('/auth?mode=signup&next=%2Fhome');
    expect(createAccountLink.className).toContain('!bg-none');
    expect(screen.getByRole('link', { name: /Sign in/i }).getAttribute('href')).toBe('/auth?next=%2Fhome');
    expect(screen.queryByRole('button', { name: 'Refresh Home' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Home sections' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Feed' })).toBeNull();
    expect(homeServiceMocks.loadParentHomeSummaryBootstrap).not.toHaveBeenCalled();
  });

  it('loads an empty opportunities feed only once', async () => {
    renderHome(signedInAuth, '/home?section=feed');

    expect(await screen.findByRole('heading', { name: 'Feed' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }));

    expect(await screen.findByText('No active opportunities')).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(opportunityServiceMocks.listPublicOpportunities).toHaveBeenCalledTimes(1);
  });

  it('renders signed-out welcome without waiting for parent or officials hydration', async () => {
    renderHome(signedOutAuth);

    expect(await screen.findByRole('heading', { name: 'Your sports day, organized' })).toBeTruthy();
    expect(screen.queryByText('ALL PLAYS User')).toBeNull();
    expect(screen.queryByText('Caught up')).toBeNull();
    expect(screen.queryByText('Loading Home')).toBeNull();
    expect(homeServiceMocks.loadParentHomeSummaryBootstrap).not.toHaveBeenCalled();
    expect(scheduleServiceMocks.loadOfficialAssignmentsAccess).not.toHaveBeenCalled();
  });

  it('resets to Today when navigation removes the Home section query param', async () => {
    render(
      <MemoryRouter initialEntries={['/home?section=feed']}>
        <Routes>
          <Route
            path="/home"
            element={(
              <>
                <Link to="/home">Home nav</Link>
                <Home auth={signedInAuth} />
              </>
            )}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Feed' })).toBeTruthy();

    fireEvent.click(screen.getByRole('link', { name: 'Home nav' }));

    expect(await screen.findByRole('heading', { name: 'Your day' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Feed' })).toBeNull();
  });

  it('exposes Home sections as navigation with the current route identified', async () => {
    renderHome(signedInAuth, '/home?section=feed');

    await screen.findByRole('heading', { name: 'Feed' });
    const navigation = screen.getByRole('navigation', { name: 'Home sections' });
    expect(within(navigation).getAllByRole('link')).toHaveLength(5);
    expect(within(navigation).getByRole('link', { name: 'Feed' }).getAttribute('aria-current')).toBe('page');
    expect(within(navigation).getByRole('link', { name: 'Today' }).getAttribute('href')).toBe('/home');
    expect(within(navigation).getByRole('link', { name: 'Friends' }).getAttribute('href')).toBe('/home?section=friends');
  });

  it('routes the Home Teams tab directly to the team page when the user has one team', async () => {
    renderHome(signedInAuth);

    expect(await screen.findByRole('heading', { name: 'Your day' })).toBeTruthy();
    const navigation = screen.getByRole('navigation', { name: 'Home sections' });
    expect(within(navigation).getByRole('link', { name: 'Teams' }).getAttribute('href')).toBe('/teams/team-1');
  });

  it('opens the team page directly when Home is loaded on the Teams section with one team', async () => {
    renderHome(signedInAuth, '/home?section=teams');

    expect(await screen.findByText('Team route')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Teams' })).toBeNull();
  });

  it('links Home pulse chips to their matching app destinations', async () => {
    const largeHome = buildLargeHomeModel();
    const socialHome = {
      ...baseSocial,
      feedItems: [baseFeedItem],
      incomingRequests: [{ id: 'friendship-1' }],
      metrics: {
        ...baseSocial.metrics,
        feedItems: 1,
        incomingRequests: 1
      }
    };
    homeServiceMocks.loadParentHomeSummaryBootstrap.mockResolvedValueOnce({ home: largeHome, schedule: [] });
    homeServiceMocks.loadParentHomeWithSecondaryData.mockResolvedValueOnce(largeHome);
    socialServiceMocks.loadSocialHome.mockResolvedValueOnce(socialHome);

    renderHome(signedInAuth);

    expect(await screen.findByRole('heading', { name: 'Your day' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Players4/ }).getAttribute('href')).toBe('/home?section=players');
    expect(screen.getByRole('link', { name: /Teams3/ }).getAttribute('href')).toBe('/home?section=teams');
    expect(screen.getByRole('link', { name: /RSVP2/ }).getAttribute('href')).toBe('/schedule?bulkRsvp=1');
    expect(screen.getByRole('link', { name: /Packets1/ }).getAttribute('href')).toBe('/schedule?view=packets');
    expect(screen.getByRole('link', { name: /Unread4/ }).getAttribute('href')).toBe('/messages');
    expect(screen.getByRole('link', { name: /Feed1/ }).getAttribute('href')).toBe('/home?section=feed');
    expect(screen.getByRole('link', { name: /Requests1/ }).getAttribute('href')).toBe('/home?section=friends');
  });

  it('shows player-scoped Multi RSVP only for players with at least two due responses', async () => {
    const scopedHome = buildLargeHomeModel();
    scopedHome.players[0].rsvpNeeded = 2;
    scopedHome.players[1].rsvpNeeded = 1;
    homeServiceMocks.loadParentHomeSummaryBootstrap.mockResolvedValueOnce({ home: scopedHome, schedule: [] });
    homeServiceMocks.loadParentHomeWithSecondaryData.mockResolvedValueOnce(scopedHome);

    renderHome(signedInAuth, '/home?section=players');

    expect(await screen.findByRole('heading', { name: 'My players' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Multi RSVP for Player 1' }).getAttribute('href'))
      .toBe('/schedule?playerId=player-1&bulkRsvp=1');
    expect(screen.queryByRole('link', { name: 'Multi RSVP for Player 2' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Multi RSVP for Player 3' })).toBeNull();
  });

  it('shows team-scoped Multi RSVP only for teams with at least two due responses', async () => {
    const scopedHome = buildLargeHomeModel();
    scopedHome.players[0].rsvpNeeded = 1;
    scopedHome.players[1].rsvpNeeded = 1;
    scopedHome.players[2].rsvpNeeded = 1;
    homeServiceMocks.loadParentHomeSummaryBootstrap.mockResolvedValueOnce({ home: scopedHome, schedule: [] });
    homeServiceMocks.loadParentHomeWithSecondaryData.mockResolvedValueOnce(scopedHome);

    renderHome(signedInAuth, '/home?section=teams');

    expect(await screen.findByRole('heading', { name: 'Teams' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Multi RSVP for Bears' }).getAttribute('href'))
      .toBe('/schedule?teamId=team-1&bulkRsvp=1');
    expect(screen.queryByRole('link', { name: 'Multi RSVP for Storm' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Multi RSVP for Falcons' })).toBeNull();
  });

  it('shows a section-level Multi RSVP action for two due responses with the bulk query contract', async () => {
    const multiRsvpHome = buildHomeWithRsvpNeeded(2);
    homeServiceMocks.loadParentHomeSummaryBootstrap.mockResolvedValueOnce({ home: multiRsvpHome, schedule: [] });
    homeServiceMocks.loadParentHomeWithSecondaryData.mockResolvedValueOnce(multiRsvpHome);

    renderHome(signedInAuth);

    const summaryActions = await screen.findByRole('region', { name: 'Availability summary actions' });
    expect(within(summaryActions).getByText('2 responses due')).toBeTruthy();
    expect(within(summaryActions).getByRole('link', { name: 'Multi RSVP' }).getAttribute('href')).toBe('/schedule?bulkRsvp=1');
  });

  it.each([0, 1])('hides the section-level Multi RSVP action when %i responses are due', async (rsvpNeeded) => {
    const home = buildHomeWithRsvpNeeded(rsvpNeeded);
    homeServiceMocks.loadParentHomeSummaryBootstrap.mockResolvedValueOnce({ home, schedule: [] });
    homeServiceMocks.loadParentHomeWithSecondaryData.mockResolvedValueOnce(home);

    renderHome(signedInAuth);

    expect(await screen.findByRole('heading', { name: 'Your day' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Availability summary actions' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Multi RSVP' })).toBeNull();
  });

  it('removes Multi RSVP after refresh leaves one eligible response', async () => {
    const initialHome = buildHomeWithRsvpNeeded(2);
    const refreshedHome = buildHomeWithRsvpNeeded(1);
    homeServiceMocks.loadParentHomeSummaryBootstrap
      .mockResolvedValueOnce({ home: initialHome, schedule: [] })
      .mockResolvedValueOnce({ home: refreshedHome, schedule: [] });
    homeServiceMocks.loadParentHomeWithSecondaryData
      .mockResolvedValueOnce(initialHome)
      .mockResolvedValueOnce(refreshedHome);

    renderHome(signedInAuth);

    expect(await screen.findByRole('link', { name: 'Multi RSVP' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Home' }));

    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'Multi RSVP' })).toBeNull();
      expect(screen.getByRole('link', { name: /Availability.*1.*Needs a response/i }).getAttribute('href')).toBe('/schedule/team-1/game-1');
    });
  });

  it.each([
    [{ ...signedInAuth, isParent: true, isCoach: false, isAdmin: false, isPlatformAdmin: false }, 'Family home'],
    [{ ...signedInAuth, roles: ['coach'], isParent: false, isCoach: true, isAdmin: false, isPlatformAdmin: false }, 'Coach home'],
    [{ ...signedInAuth, roles: ['admin'], isParent: false, isCoach: false, isAdmin: true, isPlatformAdmin: false }, 'Administration']
  ])('renders role-aware Home context', async (auth, expectedContext) => {
    renderHome(auth as AuthState);

    expect(await screen.findByText(new RegExp(expectedContext))).toBeTruthy();
  });

  it('uses official context when assignments are available', async () => {
    scheduleServiceMocks.loadOfficialAssignmentsAccess.mockResolvedValueOnce({ hasAccess: true, teamCount: 1, isPartial: false });
    renderHome({ ...signedInAuth, roles: [], isParent: false } as AuthState);

    expect(await screen.findByText(/Official assignments/)).toBeTruthy();
  });

  it.each(['assignment', 'rideshare'] as const)('counts a lone %s action as open without duplicating it in the to-do list', async (kind) => {
    const title = kind === 'assignment' ? 'Claim scorekeeper assignment' : 'Offer a ride to practice';
    const actionHome = {
      ...baseHome,
      actionItems: [{
        id: `${kind}:1`,
        kind,
        tone: 'emerald' as const,
        title,
        detail: 'Bears · Tomorrow',
        to: '/schedule/team-1/event-1',
        priority: 30,
        date: new Date('2100-06-06T18:00:00Z')
      }]
    };
    homeServiceMocks.loadParentHomeSummaryBootstrap.mockResolvedValueOnce({ home: actionHome, schedule: [] });
    homeServiceMocks.loadParentHomeWithSecondaryData.mockResolvedValueOnce(actionHome);

    renderHome(signedInAuth);

    expect(await screen.findByText('1 open')).toBeTruthy();
    expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    expect(screen.queryByText('To-do list')).toBeNull();
    expect(screen.queryByText('Also to do')).toBeNull();
    expect(screen.queryByText('Priority shown above')).toBeNull();
    expect(screen.queryByText('All caught up')).toBeNull();
  });

  it('renders remaining actions inside the priority card with an overflow count', async () => {
    const makeAction = (index: number) => ({
      id: `rsvp:${index}`,
      kind: 'rsvp' as const,
      tone: 'amber' as const,
      title: `Respond for game ${index}`,
      detail: 'Bears · Tomorrow',
      to: `/schedule/team-1/event-${index}`,
      priority: 30 + index,
      date: new Date('2100-06-06T18:00:00Z')
    });
    const actionHome = {
      ...baseHome,
      metrics: { ...baseHome.metrics, rsvpNeeded: 5 },
      actionItems: [1, 2, 3, 4, 5].map(makeAction)
    };
    homeServiceMocks.loadParentHomeSummaryBootstrap.mockResolvedValueOnce({ home: actionHome, schedule: [] });
    homeServiceMocks.loadParentHomeWithSecondaryData.mockResolvedValueOnce(actionHome);

    renderHome(signedInAuth);

    expect(await screen.findByRole('heading', { name: 'Respond for game 1' })).toBeTruthy();
    const priorityCard = screen.getByText('Do first').closest('section');
    expect(priorityCard).toBeTruthy();
    expect(within(priorityCard!).getByText('Also to do')).toBeTruthy();
    expect(within(priorityCard!).getByText('4')).toBeTruthy();
    expect(within(priorityCard!).getByText('Respond for game 2')).toBeTruthy();
    expect(within(priorityCard!).getByText('Respond for game 4')).toBeTruthy();
    expect(within(priorityCard!).queryByText('Respond for game 5')).toBeNull();
    expect(within(priorityCard!).getByText('+1 more in Schedule and Messages')).toBeTruthy();
    expect(screen.queryByText('To-do list')).toBeNull();
  });

  it('shows network-specific Home retry copy after an initial load failure', async () => {
    homeServiceMocks.loadParentHomeSummaryBootstrap.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    renderHome(signedInAuth);

    expect(await screen.findByText('Unable to load Home while offline. Check your connection and try again.')).toBeTruthy();
    expect(screen.getByText('Home could not connect')).toBeTruthy();
    expect(screen.getByText('Check your connection and try loading Home again.')).toBeTruthy();
  });

  it('does not expose a raw internal backend code after an initial Home load failure', async () => {
    homeServiceMocks.loadParentHomeSummaryBootstrap.mockRejectedValueOnce(new Error('INTERNAL'));

    renderHome(signedInAuth);

    expect(await screen.findByText('Unable to load Home. Try again.')).toBeTruthy();
    expect(screen.queryByText('INTERNAL')).toBeNull();
  });

  it('keeps the summary visible when the initial secondary load fails', async () => {
    homeServiceMocks.loadParentHomeWithSecondaryData.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    renderHome(signedInAuth);

    expect(await screen.findByText('Home details could not refresh while offline.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Your day' })).toBeTruthy();
    expect(screen.queryByText('Home could not connect')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry loading Home' })).toBeNull();
    expect(screen.getByText('Needs refresh')).toBeTruthy();
    expect(screen.queryByText('Loading')).toBeNull();
    expect(screen.queryByText('Checking actions')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Checking today’s actions…' })).toBeNull();
  });

  it('does not expose a raw internal backend code when Home details fail', async () => {
    homeServiceMocks.loadParentHomeWithSecondaryData.mockRejectedValueOnce(new Error('INTERNAL'));

    renderHome(signedInAuth);

    expect(await screen.findByText('Unable to refresh Home details. Try again.')).toBeTruthy();
    expect(screen.queryByText('INTERNAL')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Your day' })).toBeTruthy();
    expect(screen.getByText('Needs refresh')).toBeTruthy();
  });

  it('keeps the concurrent social load when a failed secondary slice does not change team scope', async () => {
    const partialHome = {
      ...baseHome,
      fees: [{ id: 'fee-1', teamId: 'team-1', teamName: 'Bears', title: 'Spring dues' }]
    } as any;
    homeServiceMocks.loadParentHomeWithSecondaryData.mockImplementationOnce((_user: unknown, options: any) => {
      options?.onPartial?.(partialHome);
      return Promise.reject(new Error('fees unavailable'));
    });
    socialServiceMocks.loadSocialHome.mockResolvedValueOnce({
      ...baseSocial,
      feedItems: [baseFeedItem],
      metrics: { ...baseSocial.metrics, feedItems: 1 }
    });

    renderHome(signedInAuth);

    expect(await screen.findByText('Needs refresh')).toBeTruthy();
    await waitFor(() => {
      expect(socialServiceMocks.loadSocialHome).toHaveBeenCalledWith(signedInAuth.user, baseHome);
    });
    expect(await screen.findByText('Pat Player highlight')).toBeTruthy();
    expect(screen.getByText('Needs refresh')).toBeTruthy();
  });

  it('keeps the Needs refresh badge when a secondary retry also fails', async () => {
    homeServiceMocks.loadParentHomeWithSecondaryData
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new Error('Permission denied for Home refresh'));

    renderHome(signedInAuth);

    expect(await screen.findByText('Home details could not refresh while offline.')).toBeTruthy();
    expect(screen.getByText('Needs refresh')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh Home' }));

    expect(await screen.findByText('Home details could not refresh because access was denied.')).toBeTruthy();
    expect(screen.getByText('Needs refresh')).toBeTruthy();
    expect(homeServiceMocks.loadParentHomeWithSecondaryData).toHaveBeenCalledTimes(2);
  });

  it('shows first-run access actions instead of an empty Today dashboard when no players or teams are linked', async () => {
    homeServiceMocks.loadParentHomeSummaryBootstrap.mockResolvedValueOnce({ home: emptyHome, schedule: [] });
    homeServiceMocks.loadParentHomeWithSecondaryData.mockResolvedValueOnce(emptyHome);

    renderHome(signedInAuth);

    expect(await screen.findByRole('heading', { name: 'Get linked to your player' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Accept invite/i }).getAttribute('href')).toBe('/accept-invite');
    expect(screen.getByRole('link', { name: /Request player access/i }).getAttribute('href')).toBe('/parent-tools/access');
    expect(screen.queryByText('All caught up')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Team feed' })).toBeNull();
    expect(screen.queryByText('Availability')).toBeNull();
    expect(screen.queryByText('Team chats')).toBeNull();
    expect(screen.queryByText('Practice packets')).toBeNull();
  });

  it('provides recovery actions in Players and Teams empty states', async () => {
    homeServiceMocks.loadParentHomeSummaryBootstrap.mockResolvedValue({ home: emptyHome, schedule: [] });
    homeServiceMocks.loadParentHomeWithSecondaryData.mockResolvedValue(emptyHome);

    const { unmount } = renderHome(signedInAuth, '/home?section=players');
    expect(await screen.findByText('No players linked yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Accept invite' }).getAttribute('href')).toBe('/accept-invite');
    expect(screen.getByRole('link', { name: 'Request player access' }).getAttribute('href')).toBe('/parent-tools/access');
    unmount();

    renderHome(signedInAuth, '/home?section=teams');
    expect(await screen.findByText('No teams available')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Request player access' }).getAttribute('href')).toBe('/parent-tools/access');
    expect(screen.getByRole('link', { name: 'Find teams' }).getAttribute('href')).toBe('/teams/browse');
  });

  it('defers the parent first-run card while secondary Home data is still pending', async () => {
    homeServiceMocks.loadParentHomeSummaryBootstrap.mockResolvedValueOnce({ home: emptyHome, schedule: [] });
    homeServiceMocks.loadParentHomeWithSecondaryData.mockImplementationOnce(() => new Promise(() => {}));

    renderHome(signedInAuth);

    await waitFor(() => {
      expect(homeServiceMocks.loadParentHomeWithSecondaryData).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText('Loading Home')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Get linked to your player' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Accept invite/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /Request player access/i })).toBeNull();
  });

  it('does not show clear or empty Today claims while linked-parent details are still loading', async () => {
    const hydratedHome = buildLargeHomeModel();
    let resolveSecondary!: (value: typeof hydratedHome) => void;
    homeServiceMocks.loadParentHomeWithSecondaryData.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSecondary = resolve;
    }));

    renderHome(signedInAuth);

    await waitFor(() => {
      expect(homeServiceMocks.loadParentHomeWithSecondaryData).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole('heading', { name: 'Checking today’s actions…' })).toBeTruthy();
    expect(screen.getByText('Checking responses…')).toBeTruthy();
    expect(screen.getByText('Checking upcoming events…')).toBeTruthy();
    expect(screen.queryByText('All caught up')).toBeNull();
    expect(screen.queryByText('Responses done')).toBeNull();
    expect(screen.queryByText('No upcoming events')).toBeNull();

    resolveSecondary(hydratedHome);

    expect(await screen.findByRole('heading', { name: 'Player 1 needs availability' })).toBeTruthy();
    expect(screen.getAllByText(/Bears Game/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: 'Checking today’s actions…' })).toBeNull();
  });

  it('makes officials access primary for first-run users with no linked players or teams', async () => {
    homeServiceMocks.loadParentHomeSummaryBootstrap.mockResolvedValueOnce({ home: emptyHome, schedule: [] });
    homeServiceMocks.loadParentHomeWithSecondaryData.mockResolvedValueOnce(emptyHome);
    scheduleServiceMocks.loadOfficialAssignmentsAccess.mockResolvedValueOnce({ hasAccess: true, teamCount: 1, isPartial: false });

    renderHome(signedInAuth);

    expect(await screen.findByRole('heading', { name: 'Manage assignments' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Officials Manage assignments/i }).getAttribute('href')).toBe('/officials');
    expect(screen.getByText('1 linked team')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Get linked to your player' })).toBeNull();
    expect(screen.getByText('Need to link a player?')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Accept invite/i }).getAttribute('href')).toBe('/accept-invite');
    expect(screen.getByRole('link', { name: /Request player access/i }).getAttribute('href')).toBe('/parent-tools/access');
  });

  it('clears officials access while a new signed-in user is being checked', async () => {
    homeServiceMocks.loadParentHomeSummaryBootstrap.mockResolvedValue({ home: emptyHome, schedule: [] });
    homeServiceMocks.loadParentHomeWithSecondaryData.mockResolvedValue(emptyHome);
    scheduleServiceMocks.loadOfficialAssignmentsAccess
      .mockResolvedValueOnce({ hasAccess: true, teamCount: 1, isPartial: false })
      .mockImplementationOnce(() => new Promise(() => {}));

    const { rerender } = render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<Home auth={signedInAuth} />} />
          <Route path="/officials" element={<div>Officials route</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Manage assignments' })).toBeTruthy();

    rerender(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<Home auth={secondSignedInAuth} />} />
          <Route path="/officials" element={<div>Officials route</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(scheduleServiceMocks.loadOfficialAssignmentsAccess).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByText('Loading Home')).toBeTruthy();
    });
    expect(screen.queryByRole('heading', { name: 'Manage assignments' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Officials Manage assignments/i })).toBeNull();
  });

  it('shows a retryable officials state instead of treating discovery failure as authoritative absence', async () => {
    homeServiceMocks.loadParentHomeSummaryBootstrap.mockResolvedValueOnce({ home: emptyHome, schedule: [] });
    homeServiceMocks.loadParentHomeWithSecondaryData.mockResolvedValueOnce(emptyHome);
    scheduleServiceMocks.loadOfficialAssignmentsAccess.mockRejectedValueOnce(new Error('access unavailable'));

    renderHome(signedInAuth);

    expect(await screen.findByRole('heading', { name: 'Assignments could not refresh' })).toBeTruthy();
    expect(screen.getByText('Open Officials to retry. Your linked teams were not treated as empty.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Get linked to your player' })).toBeNull();
  });

  it('shows verified officials access without an error card when discovery is nonempty but partial', async () => {
    homeServiceMocks.loadParentHomeSummaryBootstrap.mockResolvedValueOnce({ home: emptyHome, schedule: [] });
    homeServiceMocks.loadParentHomeWithSecondaryData.mockResolvedValueOnce(emptyHome);
    scheduleServiceMocks.loadOfficialAssignmentsAccess.mockResolvedValueOnce({
      hasAccess: true,
      teamCount: 1,
      isPartial: true
    });

    renderHome(signedInAuth);

    expect(await screen.findByRole('heading', { name: 'Manage assignments' })).toBeTruthy();
    expect(screen.getByText('1 verified linked team')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Assignments could not refresh' })).toBeNull();
  });

  it('keeps the normal Today dashboard when at least one player or team is linked', async () => {
    renderHome(signedInAuth);

    expect(await screen.findByRole('heading', { name: 'Your day' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'All caught up' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Team feed' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Get linked to your player' })).toBeNull();
  });

  it('renders secondary Home slices progressively via onPartial (#2037)', async () => {
    let capturedOnPartial: ((model: typeof baseHome) => void) | undefined;
    // Emit a partial slice, then never resolve — so anything rendered must have
    // come from the progressive onPartial update, not the final result.
    homeServiceMocks.loadParentHomeWithSecondaryData.mockImplementation((_user: unknown, options: any) => {
      capturedOnPartial = options?.onPartial;
      options?.onPartial?.({
        ...baseHome,
        fees: [{ teamId: 'team-1', id: 'fee-1', title: 'Spring dues', teamName: 'Team One' }]
      });
      return new Promise(() => {});
    });

    renderHome(signedInAuth);

    expect(await screen.findByText('Spring dues')).toBeTruthy();
    expect(capturedOnPartial).toBeTypeOf('function');
  });

  it('ignores pending Home refresh callbacks after the signed-in account changes', async () => {
    const secondHome = {
      ...baseHome,
      players: [{
        ...baseHome.players[0],
        playerId: 'player-2',
        playerName: 'Second Player'
      }],
      teams: [{
        ...baseHome.teams[0],
        teamId: 'team-2',
        teamName: 'Storm',
        players: [{
          ...baseHome.teams[0].players[0],
          teamId: 'team-2',
          teamName: 'Storm',
          playerId: 'player-2',
          playerName: 'Second Player'
        }]
      }]
    };
    let oldSummaryOptions: any;
    let oldSecondaryOptions: any;
    homeServiceMocks.loadParentHomeSummaryBootstrap.mockImplementation((user: any, options: any) => {
      if (user.uid === signedInAuth.user?.uid) {
        oldSummaryOptions = options;
        return Promise.resolve({ home: baseHome, schedule: [] });
      }
      return Promise.resolve({ home: secondHome, schedule: [] });
    });
    homeServiceMocks.loadParentHomeWithSecondaryData.mockImplementation((user: any, options: any) => {
      if (user.uid === signedInAuth.user?.uid) {
        oldSecondaryOptions = options;
        return new Promise(() => {});
      }
      return Promise.resolve(secondHome);
    });

    const { rerender } = render(
      <MemoryRouter initialEntries={['/home?section=players']}>
        <Routes>
          <Route path="/home" element={<Home auth={signedInAuth} />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(oldSummaryOptions?.onPartial).toBeTypeOf('function');
      expect(oldSecondaryOptions?.onPartial).toBeTypeOf('function');
    });

    rerender(
      <MemoryRouter initialEntries={['/home?section=players']}>
        <Routes>
          <Route path="/home" element={<Home auth={secondSignedInAuth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('Second Player')).toBeTruthy();

    act(() => {
      oldSummaryOptions.onPartial({ home: baseHome, schedule: { children: [], events: [], isPartial: true } });
      oldSecondaryOptions.onPartial(baseHome);
      oldSummaryOptions.onBackgroundError(new Error('old account refresh failed'));
      oldSecondaryOptions.onBackgroundError(new Error('old account details failed'));
    });

    expect(screen.getByText('Second Player')).toBeTruthy();
    expect(screen.queryByText('Pat Player')).toBeNull();
    expect(screen.queryByText('Needs refresh')).toBeNull();
  });

  it('reloads social data when a stale secondary cache refresh changes team scope', async () => {
    const refreshedHome = {
      ...baseHome,
      players: [{
        ...baseHome.players[0],
        teamId: 'team-2',
        teamName: 'Storm',
        playerId: 'player-2',
        playerName: 'Second Player'
      }],
      teams: [{
        ...baseHome.teams[0],
        teamId: 'team-2',
        teamName: 'Storm',
        players: [{
          ...baseHome.teams[0].players[0],
          teamId: 'team-2',
          teamName: 'Storm',
          playerId: 'player-2',
          playerName: 'Second Player'
        }]
      }]
    };
    const staleSocial = {
      ...baseSocial,
      feedItems: [baseFeedItem],
      metrics: { ...baseSocial.metrics, feedItems: 1 }
    };
    const refreshedSocial = {
      ...baseSocial,
      feedItems: [{
        ...baseFeedItem,
        id: 'post-2',
        teamId: 'team-2',
        teamName: 'Storm',
        playerIds: ['player-2'],
        playerNames: ['Second Player'],
        sourceId: 'player-2',
        title: 'Second Player highlight',
        detail: 'Player moment · Second Player · Storm',
        route: '/players/team-2/player-2'
      }],
      metrics: { ...baseSocial.metrics, feedItems: 1 }
    };
    let secondaryOptions: any;
    homeServiceMocks.loadParentHomeWithSecondaryData.mockImplementationOnce((_user: unknown, options: any) => {
      secondaryOptions = options;
      return Promise.resolve(baseHome);
    });
    socialServiceMocks.loadSocialHome
      .mockResolvedValueOnce(staleSocial)
      .mockResolvedValueOnce(refreshedSocial);

    renderHome(signedInAuth, '/home?section=feed');

    expect(await screen.findByText('Pat Player highlight')).toBeTruthy();

    await act(async () => {
      secondaryOptions.onPartial(refreshedHome);
    });

    await waitFor(() => {
      expect(socialServiceMocks.loadSocialHome).toHaveBeenLastCalledWith(signedInAuth.user, refreshedHome);
    });
    expect(await screen.findByText('Second Player highlight')).toBeTruthy();
    expect(screen.queryByText('Pat Player highlight')).toBeNull();
  });

  it('records meaningful Home render without waiting for social data', async () => {
    const largeHome = buildLargeHomeModel();
    let resolveSocial!: (value: typeof baseSocial) => void;
    homeServiceMocks.loadParentHomeWithSecondaryData.mockResolvedValueOnce(largeHome);
    socialServiceMocks.loadSocialHome.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSocial = resolve;
    }));

    renderHome(signedInAuth);

    expect(await screen.findByText('2 open assignments')).toBeTruthy();
    expect(socialServiceMocks.loadSocialHome).toHaveBeenCalledWith(signedInAuth.user, largeHome);
    expect(uxTimingMocks.recordFirstMeaningfulRender).toHaveBeenCalledWith('home');

    resolveSocial(baseSocial);

    await waitFor(() => {
      expect(uxTimingMocks.recordFirstMeaningfulRender).toHaveBeenCalledTimes(1);
    });
  });

  it('refreshes the social feed with the async loading helper', async () => {
    renderHome(signedInAuth, '/home?section=feed');

    await screen.findByRole('heading', { name: 'Feed' });
    await waitFor(() => {
      expect(socialServiceMocks.loadSocialHome).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Refresh feed' }));

    await waitFor(() => {
      expect(socialServiceMocks.loadSocialHome).toHaveBeenCalledTimes(2);
    });
  });

  it('labels Feed filters and gives an empty Feed one primary next action', async () => {
    renderHome(signedInAuth, '/home?section=feed');

    await screen.findByRole('heading', { name: 'Feed' });
    const filters = screen.getByRole('group', { name: 'Feed filters' });
    expect(within(filters).getAllByRole('button')).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Create a post' })).toBeTruthy();
  });

  it('keeps legacy posts visible but omits unsafe source actions in feed cards', async () => {
    socialServiceMocks.loadSocialHome.mockResolvedValueOnce({
      ...baseSocial,
      feedItems: [{
        ...baseFeedItem,
        id: 'unsafe-post',
        title: 'Stored team update',
        route: '//example.invalid/source',
        href: 'mailto:team@example.invalid'
      }],
      metrics: { ...baseSocial.metrics, feedItems: 1 }
    });

    renderHome(signedInAuth, '/home?section=feed');

    expect(await screen.findByText('Stored team update')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open source' })).toBeNull();
  });

  it('keeps canonical app routes actionable in feed cards', async () => {
    socialServiceMocks.loadSocialHome.mockResolvedValueOnce({
      ...baseSocial,
      feedItems: [baseFeedItem],
      metrics: { ...baseSocial.metrics, feedItems: 1 }
    });

    renderHome(signedInAuth, '/home?section=feed');

    expect((await screen.findByRole('link', { name: 'Open source' })).getAttribute('href'))
      .toBe('/players/team-1/player-1');
  });

  it('omits unsafe source actions from Home feed previews', async () => {
    socialServiceMocks.loadSocialHome.mockResolvedValueOnce({
      ...baseSocial,
      feedItems: [{
        ...baseFeedItem,
        id: 'unsafe-preview',
        title: 'Stored preview update',
        route: '/\\example.invalid/source',
        href: null
      }],
      metrics: { ...baseSocial.metrics, feedItems: 1 }
    });

    renderHome(signedInAuth);

    const title = await screen.findByText('Stored preview update');
    expect(title.closest('a')).toBeNull();
  });

  it('optimistically updates likes and blocks rapid double taps from writing twice', async () => {
    let resolveLike: () => void = () => {};
    socialServiceMocks.loadSocialHome.mockResolvedValueOnce({
      ...baseSocial,
      feedItems: [baseFeedItem],
      metrics: { ...baseSocial.metrics, feedItems: 1 }
    });
    socialServiceMocks.reactToSocialPost.mockImplementationOnce(() => new Promise((resolve) => {
      resolveLike = () => resolve(undefined);
    }));

    renderHome(signedInAuth, '/home?section=feed');

    await screen.findByRole('heading', { name: 'Feed' });
    const likeButton = await screen.findByRole('button', { name: 'Like post, 2 likes' });

    fireEvent.click(likeButton);
    fireEvent.click(likeButton);

    expect(screen.getByRole('button', { name: 'Unlike post, 3 likes' })).toBeTruthy();
    expect(socialServiceMocks.reactToSocialPost).toHaveBeenCalledTimes(1);

    resolveLike();

    await waitFor(() => {
      expect(socialServiceMocks.loadSocialHome).toHaveBeenCalledTimes(2);
    });
  });

  it('surfaces incomplete feed state and disables Like when the viewer reaction is unknown', async () => {
    socialServiceMocks.loadSocialHome.mockResolvedValueOnce({
      ...baseSocial,
      feedItems: [{ ...baseFeedItem, viewerHasLiked: undefined, viewerReactionError: true }],
      feedError: 'Some feed details could not load. Retry before relying on the complete post or Like state.',
      metrics: { ...baseSocial.metrics, feedItems: 1 }
    });

    renderHome(signedInAuth, '/home?section=feed');

    expect(await screen.findByRole('alert')).toHaveTextContent('Some feed details could not load');
    const likeButton = screen.getByRole('button', { name: 'Like status unavailable, 2 likes' });
    expect(likeButton).toBeDisabled();
    fireEvent.click(likeButton);
    expect(socialServiceMocks.reactToSocialPost).not.toHaveBeenCalled();
  });

  it('optimistically removes an existing like', async () => {
    let resolveUnlike: () => void = () => {};
    socialServiceMocks.loadSocialHome.mockResolvedValueOnce({
      ...baseSocial,
      feedItems: [{ ...baseFeedItem, viewerHasLiked: true }],
      metrics: { ...baseSocial.metrics, feedItems: 1 }
    });
    socialServiceMocks.reactToSocialPost.mockImplementationOnce(() => new Promise((resolve) => {
      resolveUnlike = () => resolve({ liked: false, count: 1 });
    }));

    renderHome(signedInAuth, '/home?section=feed');

    const unlikeButton = await screen.findByRole('button', { name: 'Unlike post, 2 likes' });
    fireEvent.click(unlikeButton);

    expect(screen.getByRole('button', { name: 'Like post, 1 like' })).toBeTruthy();
    resolveUnlike();
    await waitFor(() => expect(socialServiceMocks.loadSocialHome).toHaveBeenCalledTimes(2));
  });

  it('optimistically hides a post, blocks duplicate taps, and refreshes once', async () => {
    let resolveHide: () => void = () => {};
    socialServiceMocks.loadSocialHome.mockResolvedValueOnce({
      ...baseSocial,
      feedItems: [baseFeedItem],
      metrics: { ...baseSocial.metrics, feedItems: 1 }
    });
    socialServiceMocks.hideSocialPost.mockImplementationOnce(() => new Promise((resolve) => {
      resolveHide = () => resolve(undefined);
    }));

    renderHome(signedInAuth, '/home?section=feed');

    const hideButton = await screen.findByRole('button', { name: 'Hide' });
    fireEvent.click(hideButton);
    fireEvent.click(hideButton);
    expect(screen.queryByText('Pat Player highlight')).toBeNull();
    expect(socialServiceMocks.hideSocialPost).toHaveBeenCalledTimes(1);

    resolveHide();
    await waitFor(() => expect(socialServiceMocks.loadSocialHome).toHaveBeenCalledTimes(2));
  });

  it('restores an optimistically hidden post when the hide write fails', async () => {
    let rejectHide: () => void = () => {};
    socialServiceMocks.loadSocialHome.mockResolvedValueOnce({
      ...baseSocial,
      feedItems: [baseFeedItem],
      metrics: { ...baseSocial.metrics, feedItems: 1 }
    });
    socialServiceMocks.hideSocialPost.mockImplementationOnce(() => new Promise((_, reject) => {
      rejectHide = () => reject(new Error('Hide unavailable.'));
    }));

    renderHome(signedInAuth, '/home?section=feed');

    fireEvent.click(await screen.findByRole('button', { name: 'Hide' }));
    expect(screen.queryByText('Pat Player highlight')).toBeNull();

    rejectHide();

    expect(await screen.findByText('Pat Player highlight')).toBeTruthy();
    expect(await screen.findByText('Hide unavailable.')).toBeTruthy();
    expect(socialServiceMocks.loadSocialHome).toHaveBeenCalledTimes(1);
  });

  it('keeps a successfully hidden post removed when the follow-up refresh fails', async () => {
    socialServiceMocks.loadSocialHome
      .mockResolvedValueOnce({
        ...baseSocial,
        feedItems: [baseFeedItem],
        metrics: { ...baseSocial.metrics, feedItems: 1 }
      })
      .mockRejectedValueOnce(new Error('Refresh unavailable.'));

    renderHome(signedInAuth, '/home?section=feed');

    fireEvent.click(await screen.findByRole('button', { name: 'Hide' }));

    await waitFor(() => expect(socialServiceMocks.loadSocialHome).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Pat Player highlight')).toBeNull();
    expect(await screen.findByText('Post hidden from your feed. Refresh to see the latest feed.')).toBeTruthy();
  });

  it('optimistically clears comment input, increments the count, and blocks duplicate submits', async () => {
    let resolveComment: () => void = () => {};
    socialServiceMocks.loadSocialHome.mockResolvedValueOnce({
      ...baseSocial,
      feedItems: [baseFeedItem],
      metrics: { ...baseSocial.metrics, feedItems: 1 }
    });
    socialServiceMocks.commentOnSocialPost.mockImplementationOnce(() => new Promise((resolve) => {
      resolveComment = () => resolve(undefined);
    }));

    renderHome(signedInAuth, '/home?section=feed');

    await screen.findByRole('heading', { name: 'Feed' });
    const commentInput = screen.getByPlaceholderText('Comment · 1') as HTMLInputElement;
    fireEvent.change(commentInput, { target: { value: 'Nice play!' } });
    const sendButton = screen.getByRole('button', { name: 'Send' });

    fireEvent.click(sendButton);
    fireEvent.click(sendButton);

    expect(socialServiceMocks.commentOnSocialPost).toHaveBeenCalledTimes(1);
    expect((screen.getByPlaceholderText('Comment · 2') as HTMLInputElement).value).toBe('');

    resolveComment();

    await waitFor(() => {
      expect(socialServiceMocks.loadSocialHome).toHaveBeenCalledTimes(2);
    });
  });

  it('restores the submitted comment when the request fails', async () => {
    socialServiceMocks.loadSocialHome.mockResolvedValueOnce({
      ...baseSocial,
      feedItems: [baseFeedItem],
      metrics: { ...baseSocial.metrics, feedItems: 1 }
    });
    socialServiceMocks.commentOnSocialPost.mockRejectedValueOnce(new Error('Unable to add comment.'));

    renderHome(signedInAuth, '/home?section=feed');

    await screen.findByRole('heading', { name: 'Feed' });
    const commentInput = screen.getByPlaceholderText('Comment · 1') as HTMLInputElement;
    fireEvent.change(commentInput, { target: { value: 'Nice play!' } });

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect((screen.getByPlaceholderText('Comment · 2') as HTMLInputElement).value).toBe('');

    await waitFor(() => {
      expect(screen.getByText('Unable to add comment.')).toBeTruthy();
    });

    expect((screen.getByPlaceholderText('Comment · 1') as HTMLInputElement).value).toBe('Nice play!');
  });

  it('opens the requested team media composer from the route and refreshes the social feed after posting', async () => {
    socialServiceMocks.createSocialPost.mockResolvedValueOnce('post-1');
    renderHome(signedInAuth, '/home?section=feed&social=create&type=team_media');

    const dialog = await screen.findByRole('dialog', { name: 'Create social post' });
    expect(within(dialog).getAllByText('Photo or video').length).toBeGreaterThan(0);
    expect(within(dialog).getByText('Choose photo or video')).toBeTruthy();
    await waitFor(() => {
      expect(socialServiceMocks.loadSocialHome).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(screen.getByLabelText(/choose photo or video/i), {
      target: {
        files: [new File(['image-bytes'], 'team-photo.png', { type: 'image/png' })]
      }
    });
    const postButtons = screen.getAllByRole('button', { name: 'Post' });
    fireEvent.click(postButtons[postButtons.length - 1]!);

    await waitFor(() => {
      expect(socialServiceMocks.createSocialPost).toHaveBeenCalledTimes(1);
      expect(socialServiceMocks.loadSocialHome).toHaveBeenCalledTimes(2);
    });
  });

  it('switches player context with the selected team before creating a player post', async () => {
    const switchableHome = buildSwitchableComposerHome();
    homeServiceMocks.loadParentHomeSummaryBootstrap.mockResolvedValueOnce({ home: switchableHome, schedule: [] });
    homeServiceMocks.loadParentHomeWithSecondaryData.mockResolvedValue(switchableHome);
    socialServiceMocks.createSocialPost.mockResolvedValueOnce('post-player-2');
    renderHome(signedInAuth, '/home?section=feed&social=create&type=player_moment');

    const dialog = await screen.findByRole('dialog', { name: 'Create social post' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pat Player · Bears' }));
    fireEvent.change(within(dialog).getByLabelText('Team'), { target: { value: 'team-2' } });

    const playerSelect = within(dialog).getByLabelText('Player') as HTMLSelectElement;
    expect(playerSelect.value).toBe('team-2::player-2');
    expect(within(playerSelect).queryByRole('option', { name: 'Pat Player · Bears' })).toBeNull();
    expect(within(playerSelect).getByRole('option', { name: 'Sam Player · Storm' })).toBeTruthy();

    fireEvent.change(within(dialog).getByPlaceholderText('What stood out today?'), { target: { value: 'Great hustle.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Post' }));

    await waitFor(() => {
      expect(socialServiceMocks.createSocialPost).toHaveBeenCalledWith(signedInAuth.user, expect.objectContaining({
        teamId: 'team-2',
        teamName: 'Storm',
        playerIds: ['player-2'],
        playerNames: ['Sam Player'],
        sourceType: 'player',
        sourceId: 'player-2',
        route: '/players/team-2/player-2'
      }));
    });
  });

  it('does not create a player post after switching to a team with no selectable player', async () => {
    const switchableHome = buildSwitchableComposerHome();
    const noStormPlayerHome = {
      ...switchableHome,
      players: switchableHome.players.filter((player) => player.teamId !== 'team-2')
    };
    homeServiceMocks.loadParentHomeSummaryBootstrap.mockResolvedValueOnce({ home: noStormPlayerHome, schedule: [] });
    homeServiceMocks.loadParentHomeWithSecondaryData.mockResolvedValue(noStormPlayerHome);
    renderHome(signedInAuth, '/home?section=feed&social=create&type=player_moment');

    const dialog = await screen.findByRole('dialog', { name: 'Create social post' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pat Player · Bears' }));
    fireEvent.change(within(dialog).getByLabelText('Team'), { target: { value: 'team-2' } });
    fireEvent.change(within(dialog).getByPlaceholderText('What stood out today?'), { target: { value: 'Great effort.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Post' }));

    expect(await within(dialog).findByText('Choose a player for this post.')).toBeTruthy();
    expect(socialServiceMocks.createSocialPost).not.toHaveBeenCalled();
  });

  it('switches game context and stores a game source with a direct schedule route', async () => {
    const switchableHome = buildSwitchableComposerHome();
    homeServiceMocks.loadParentHomeSummaryBootstrap.mockResolvedValueOnce({ home: switchableHome, schedule: [] });
    homeServiceMocks.loadParentHomeWithSecondaryData.mockResolvedValue(switchableHome);
    socialServiceMocks.createSocialPost.mockResolvedValueOnce('post-game-2');
    renderHome(signedInAuth, '/home?section=feed&social=create&type=game_recap');

    const dialog = await screen.findByRole('dialog', { name: 'Create social post' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Falcons/ }));
    const gameSelect = within(dialog).getByLabelText('Game') as HTMLSelectElement;
    fireEvent.change(gameSelect, {
      target: { value: 'team-1::game-2::2026-07-11T18:00:00.000Z' }
    });
    expect(within(gameSelect).getByRole('option', { name: /Rockets/ })).toBeTruthy();
    expect(within(gameSelect).queryByRole('option', { name: /Owls/ })).toBeNull();

    fireEvent.change(within(dialog).getByPlaceholderText('How did the game go?'), { target: { value: 'Strong finish.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Post' }));

    await waitFor(() => {
      expect(socialServiceMocks.createSocialPost).toHaveBeenCalledWith(signedInAuth.user, expect.objectContaining({
        teamId: 'team-1',
        teamName: 'Bears',
        playerIds: [],
        sourceType: 'game',
        sourceId: 'game-2',
        route: '/schedule/team-1/game-2?childId=player-1'
      }));
    });
  });

  it('requires a completed game before uploading media for a recap', async () => {
    const switchableHome = buildSwitchableComposerHome();
    const upcomingOnlyHome = { ...switchableHome, feedGames: switchableHome.feedGames.filter((game) => game.id === 'game-3') };
    homeServiceMocks.loadParentHomeSummaryBootstrap.mockResolvedValueOnce({ home: upcomingOnlyHome, schedule: [] });
    homeServiceMocks.loadParentHomeWithSecondaryData.mockResolvedValue(upcomingOnlyHome);
    renderHome(signedInAuth, '/home?section=feed&social=create&type=game_recap');

    const dialog = await screen.findByRole('dialog', { name: 'Create social post' });
    fireEvent.change(within(dialog).getByPlaceholderText('How did the game go?'), { target: { value: 'Recap note.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Post' }));

    expect(await within(dialog).findByText('Choose a completed game for this recap.')).toBeTruthy();
    expect(socialServiceMocks.uploadSocialPostMedia).not.toHaveBeenCalled();
    expect(socialServiceMocks.createSocialPost).not.toHaveBeenCalled();
  });

  it('does not offer an in-progress game as a recap after its kickoff time', async () => {
    const switchableHome = buildSwitchableComposerHome();
    const liveGame = {
      ...switchableHome.feedGames[0],
      id: 'game-live',
      eventKey: 'team-1::game-live::player-1',
      status: 'scheduled',
      liveStatus: 'live'
    };
    const liveOnlyHome = { ...switchableHome, feedGames: [liveGame] };
    homeServiceMocks.loadParentHomeSummaryBootstrap.mockResolvedValueOnce({ home: liveOnlyHome, schedule: [] });
    homeServiceMocks.loadParentHomeWithSecondaryData.mockResolvedValue(liveOnlyHome);
    renderHome(signedInAuth, '/home?section=feed&social=create&type=game_recap');

    const dialog = await screen.findByRole('dialog', { name: 'Create social post' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bears' }));

    expect(within(dialog).getByLabelText('Game')).toHaveValue('');
    expect(within(dialog).getByRole('option', { name: 'No games on this team' })).toBeTruthy();
  });

  it('removes uploaded feed media when post creation fails', async () => {
    socialServiceMocks.createSocialPost.mockRejectedValueOnce(new Error('Post write failed.'));
    renderHome(signedInAuth, '/home?section=feed&social=create&type=team_media');

    const dialog = await screen.findByRole('dialog', { name: 'Create social post' });
    fireEvent.change(within(dialog).getByLabelText(/choose photo or video/i), {
      target: { files: [new File(['image'], 'social.jpg', { type: 'image/jpeg' })] }
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Post' }));

    await waitFor(() => {
      expect(socialServiceMocks.discardSocialPostMediaUpload).toHaveBeenCalledWith(expect.objectContaining({
        storagePath: 'stat-sheets/team-chat/team-1/team/parent-1/social.jpg'
      }));
    });
    expect(await within(dialog).findByText('Post write failed.')).toBeTruthy();
  });

  it('shows a newly created post before background feed reconciliation completes', async () => {
    let resolveRefresh: (value: any) => void = () => {};
    const createdPost = {
      ...baseFeedItem,
      id: 'post-new',
      authorId: 'parent-1',
      authorName: 'Pat Parent',
      title: 'Pat Player highlight just posted',
      createdAt: new Date('2100-06-02T18:00:00Z'),
      reactionCounts: {},
      commentCount: 0,
      viewerHasLiked: false
    };
    socialServiceMocks.loadSocialHome
      .mockResolvedValueOnce(baseSocial)
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveRefresh = resolve;
      }));
    socialServiceMocks.createSocialPost.mockResolvedValueOnce(createdPost);

    renderHome(signedInAuth, '/home?section=feed&social=create&type=player_moment');

    const dialog = await screen.findByRole('dialog', { name: 'Create social post' });
    fireEvent.change(within(dialog).getByPlaceholderText('What stood out today?'), { target: { value: 'Great effort.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Post' }));

    expect(await screen.findByText('Pat Player highlight just posted')).toBeTruthy();
    expect(screen.getByText('Posted to your ALL PLAYS feed.')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Posted to your ALL PLAYS feed.');
    expect(socialServiceMocks.loadSocialHome).toHaveBeenCalledTimes(2);
    resolveRefresh({ ...baseSocial, feedItems: [createdPost], metrics: { ...baseSocial.metrics, feedItems: 1 } });
    await waitFor(() => {
      expect(screen.getByText('Posted to your ALL PLAYS feed.')).toBeTruthy();
    });
  });

  it('shows permission-specific Home refresh copy when access is denied after a prior load', async () => {
    homeServiceMocks.loadParentHomeSummaryBootstrap
      .mockResolvedValueOnce({ home: baseHome, schedule: [] })
      .mockRejectedValueOnce(new Error('Permission denied for Home refresh'));

    renderHome(signedInAuth);

    await screen.findByRole('heading', { name: 'Your day' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Home' }));

    expect(await screen.findByText('Unable to refresh Home because access was denied. Showing the last loaded Home.')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Unable to refresh Home because access was denied.');
  });

  it('refreshes the social feed after responding to a friend request', async () => {
    socialServiceMocks.loadSocialHome.mockResolvedValueOnce({
      ...baseSocial,
      incomingRequests: [
        {
          id: 'friendship-1',
          userId: 'friend-1',
          name: 'Jamie Friend',
          email: 'jamie@example.com',
          photoUrl: null,
          sharedTeamIds: ['team-1'],
          sharedTeamNames: ['Bears'],
          status: 'pending',
          requesterId: 'friend-1',
          recipientId: 'parent-1'
        }
      ],
      metrics: {
        ...baseSocial.metrics,
        incomingRequests: 1
      }
    });
    renderHome(signedInAuth, '/home?section=friends');

    await screen.findByRole('heading', { name: 'Friends' });
    expect(screen.getByLabelText('Search friends by name, email, or team')).toBeTruthy();
    await waitFor(() => {
      expect(socialServiceMocks.loadSocialHome).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    await waitFor(() => {
      expect(socialServiceMocks.respondToFriendRequest).toHaveBeenCalledWith('friendship-1', 'accepted');
      expect(socialServiceMocks.loadSocialHome).toHaveBeenCalledTimes(2);
    });
  });

  it('shows a retryable friend request load error instead of an empty request list', async () => {
    socialServiceMocks.loadSocialHome.mockResolvedValueOnce({
      ...baseSocial,
      friendshipsError: 'Missing index for friendships.'
    });

    renderHome(signedInAuth, '/home?section=friends');

    await screen.findByRole('heading', { name: 'Friends' });
    expect(await screen.findByText("Couldn't load friend requests")).toBeTruthy();
    expect(screen.getByText('Missing index for friendships.')).toBeTruthy();
    expect(screen.queryByText('No requests right now')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(socialServiceMocks.loadSocialHome).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText('No requests right now')).toBeTruthy();
  });

  it('renders Today content from larger Home payloads and keeps it visible after refresh', async () => {
    const largeHome = buildLargeHomeModel();
    homeServiceMocks.loadParentHomeSummaryBootstrap.mockResolvedValueOnce({ home: largeHome, schedule: [] });
    homeServiceMocks.loadParentHomeWithSecondaryData.mockResolvedValue(largeHome);

    renderHome(signedInAuth);

    expect(await screen.findByRole('heading', { name: 'Your day' })).toBeTruthy();
    expect(screen.getByText('Upcoming')).toBeTruthy();
    expect(screen.getAllByText('Player 1 needs availability')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Ask AI' }).getAttribute('href')).toBe('/ai');
    expect(screen.getByRole('link', { name: 'Open action' }).getAttribute('href')).toBe('/schedule/team-1/upcoming-1');
    expect(screen.getByRole('link', { name: /Availability.*2.*Needs a response/i }).getAttribute('href')).toBe('/schedule?bulkRsvp=1');
    expect(screen.getByRole('link', { name: 'Multi RSVP' }).getAttribute('href')).toBe('/schedule?bulkRsvp=1');
    expect(screen.getByText('2 open assignments')).toBeTruthy();
    expect(screen.getByText('+2 more in Schedule and Messages')).toBeTruthy();
    expect(screen.getAllByText('Tournament fee').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh Home' }));

    await waitFor(() => {
      expect(homeServiceMocks.loadParentHomeSummaryBootstrap).toHaveBeenCalledTimes(2);
      expect(homeServiceMocks.loadParentHomeWithSecondaryData).toHaveBeenCalledTimes(2);
    });

    expect(screen.getByRole('heading', { name: 'Your day' })).toBeTruthy();
    expect(screen.getByText('Practice packet ready')).toBeTruthy();
  });
});
