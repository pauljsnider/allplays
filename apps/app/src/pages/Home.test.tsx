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

    expect(await screen.findByRole('heading', { name: 'Feed' })).toBeInTheDocument();
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
});
