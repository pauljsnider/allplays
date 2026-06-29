// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
vi.mock('../lib/uxTiming', () => uxTimingMocks);
vi.mock('lucide-react', () => {
  const Icon = () => null;
  return {
    AlertCircle: Icon,
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
  metrics: {
    feedItems: 0,
    friends: 0,
    incomingRequests: 0,
    suggestions: 0
  }
};

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
      rsvpNeeded: 1,
      unreadMessages: 4,
      packetsReady: 1
    }
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

function renderHome(auth: AuthState, initialEntry = '/home') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/home" element={<Home auth={auth} />} />
        <Route path="/teams/:teamId" element={<div>Team route</div>} />
        <Route path="/messages" element={<div>Messages route</div>} />
        <Route path="/schedule" element={<div>Schedule route</div>} />
        <Route path="/officials" element={<div>Officials route</div>} />
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
    scheduleServiceMocks.loadOfficialAssignmentsAccess.mockResolvedValue({ hasAccess: false, teamCount: 0 });
  });

  afterEach(() => {
    cleanup();
  });

  it('waits for the initial secondary Home load to finish before recording first meaningful render', async () => {
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

    expect(await screen.findByRole('heading', { name: 'Today for your players' })).toBeTruthy();
    expect(uxTimingMocks.recordFirstMeaningfulRender).not.toHaveBeenCalled();

    resolveSecondary(baseHome);

    await waitFor(() => {
      expect(uxTimingMocks.recordFirstMeaningfulRender).toHaveBeenCalledWith('home');
    });
  });

  it('renders the feed for signed-out users without crashing', async () => {
    renderHome(signedOutAuth, '/home?section=feed');

    expect(await screen.findByRole('heading', { name: 'Feed' })).toBeTruthy();
    expect(homeServiceMocks.loadParentHomeSummaryBootstrap).not.toHaveBeenCalled();
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

    expect(await screen.findByRole('heading', { name: 'Today for your players' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Feed' })).toBeNull();
  });

  it('shows network-specific Home retry copy after an initial load failure', async () => {
    homeServiceMocks.loadParentHomeSummaryBootstrap.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    renderHome(signedInAuth);

    expect(await screen.findByText('Unable to load Home while offline. Check your connection and try again.')).toBeTruthy();
    expect(screen.getByText('Home could not connect')).toBeTruthy();
    expect(screen.getByText('Check your connection and try loading Home again.')).toBeTruthy();
  });

  it('shows retryable Home error UI when the initial secondary load fails', async () => {
    homeServiceMocks.loadParentHomeWithSecondaryData.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    renderHome(signedInAuth);

    expect(await screen.findByText('Home could not connect')).toBeTruthy();
    expect(screen.getByText('Check your connection and try loading Home again.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry loading Home' })).toBeTruthy();
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

  it('renders secondary Home details before social data finishes loading', async () => {
    const largeHome = buildLargeHomeModel();
    let resolveSocial!: (value: typeof baseSocial) => void;
    homeServiceMocks.loadParentHomeWithSecondaryData.mockResolvedValueOnce(largeHome);
    socialServiceMocks.loadSocialHome.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSocial = resolve;
    }));

    renderHome(signedInAuth);

    expect(await screen.findByText('Falcons')).toBeTruthy();
    expect(socialServiceMocks.loadSocialHome).toHaveBeenCalledWith(signedInAuth.user, largeHome);
    expect(uxTimingMocks.recordFirstMeaningfulRender).not.toHaveBeenCalled();

    resolveSocial(baseSocial);

    await waitFor(() => {
      expect(uxTimingMocks.recordFirstMeaningfulRender).toHaveBeenCalledWith('home');
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
    const likeButton = await screen.findByRole('button', { name: /2$/ });

    fireEvent.click(likeButton);
    fireEvent.click(likeButton);

    expect(screen.getByRole('button', { name: /3$/ })).toBeTruthy();
    expect(socialServiceMocks.reactToSocialPost).toHaveBeenCalledTimes(1);

    resolveLike();

    await waitFor(() => {
      expect(socialServiceMocks.loadSocialHome).toHaveBeenCalledTimes(2);
    });
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

  it('shows permission-specific Home refresh copy when access is denied after a prior load', async () => {
    homeServiceMocks.loadParentHomeSummaryBootstrap
      .mockResolvedValueOnce({ home: baseHome, schedule: [] })
      .mockRejectedValueOnce(new Error('Permission denied for Home refresh'));

    renderHome(signedInAuth);

    await screen.findByRole('heading', { name: 'Today for your players' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Home' }));

    expect(await screen.findByText('Unable to refresh Home because access was denied. Showing the last loaded Home.')).toBeTruthy();
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
    await waitFor(() => {
      expect(socialServiceMocks.loadSocialHome).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    await waitFor(() => {
      expect(socialServiceMocks.respondToFriendRequest).toHaveBeenCalledWith('friendship-1', 'accepted');
      expect(socialServiceMocks.loadSocialHome).toHaveBeenCalledTimes(2);
    });
  });

  it('renders Today content from larger Home payloads and keeps it visible after refresh', async () => {
    const largeHome = buildLargeHomeModel();
    homeServiceMocks.loadParentHomeSummaryBootstrap.mockResolvedValueOnce({ home: largeHome, schedule: [] });
    homeServiceMocks.loadParentHomeWithSecondaryData.mockResolvedValue(largeHome);

    renderHome(signedInAuth);

    expect(await screen.findByRole('heading', { name: 'Today for your players' })).toBeTruthy();
    expect(screen.getByText('Upcoming')).toBeTruthy();
    expect(screen.getAllByText('Player 1 needs availability').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /do\s*player 1 needs availability/i }).getAttribute('href')).toBe('/schedule/team-1/upcoming-1');
    expect(screen.getByText('Falcons')).toBeTruthy();
    expect(screen.getAllByText('Tournament fee').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh Home' }));

    await waitFor(() => {
      expect(homeServiceMocks.loadParentHomeSummaryBootstrap).toHaveBeenCalledTimes(2);
      expect(homeServiceMocks.loadParentHomeWithSecondaryData).toHaveBeenCalledTimes(2);
    });

    expect(screen.getByRole('heading', { name: 'Today for your players' })).toBeTruthy();
    expect(screen.getByText('1 unread message')).toBeTruthy();
  });
});
