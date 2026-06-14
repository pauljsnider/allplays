// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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

vi.mock('../components/PageSkeletons', () => ({
  HomePageSkeleton: () => <div>Loading Home</div>
}));
vi.mock('../lib/homeService', () => homeServiceMocks);
vi.mock('../lib/socialService', () => socialServiceMocks);
vi.mock('../lib/scheduleService', () => scheduleServiceMocks);
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

  it('renders the feed for signed-out users without crashing', async () => {
    renderHome(signedOutAuth, '/home?section=feed');

    expect(await screen.findByRole('heading', { name: 'Feed' })).toBeTruthy();
    expect(homeServiceMocks.loadParentHomeSummaryBootstrap).not.toHaveBeenCalled();
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

  it('refreshes the social feed after creating a post', async () => {
    socialServiceMocks.createSocialPost.mockResolvedValueOnce('post-1');
    renderHome(signedInAuth, '/home?section=feed&social=create');

    await screen.findByRole('dialog', { name: 'Create social post' });
    await waitFor(() => {
      expect(socialServiceMocks.loadSocialHome).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Big team win today.' }
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Post' }).at(-1)!);

    await waitFor(() => {
      expect(socialServiceMocks.createSocialPost).toHaveBeenCalledTimes(1);
      expect(socialServiceMocks.loadSocialHome).toHaveBeenCalledTimes(2);
    });
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
});
