// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from '../lib/types';
import type { MatchingPost } from '../lib/matchingLogic';

const matchingServiceMocks = vi.hoisted(() => ({
  createMatchingPost: vi.fn(),
  dismissMatchingResponse: vi.fn(),
  loadMatchingResponses: vi.fn(),
  loadMyMatchingPosts: vi.fn(),
  loadOpenMatchingPosts: vi.fn(),
  respondToMatchingPost: vi.fn(),
  setMatchingPostStatus: vi.fn()
}));

const homeServiceMocks = vi.hoisted(() => ({
  loadParentHome: vi.fn()
}));

vi.mock('../lib/matchingService', () => matchingServiceMocks);
vi.mock('../lib/homeService', () => homeServiceMocks);

import { Opportunities } from './Opportunities';

const auth: AuthState = {
  user: {
    uid: 'parent-1',
    email: 'parent@example.com',
    displayName: 'Parent One'
  } as any,
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
} as unknown as AuthState;

function matchingPost(overrides: Partial<MatchingPost> = {}): MatchingPost {
  return {
    id: 'post-1',
    kind: 'player_seeking_team',
    status: 'open',
    authorId: 'author-1',
    authorName: 'Author One',
    authorPhotoUrl: null,
    teamId: null,
    teamName: null,
    title: 'Ethan (U12 Soccer) is looking for a team',
    description: 'Loves midfield.',
    matching: {
      kind: 'player_seeking_team',
      sport: 'Soccer',
      ageGroup: 'U12',
      city: 'Columbus',
      state: 'OH',
      zip: '',
      positions: '',
      level: '',
      timeframe: '',
      openSpots: null,
      playerFirstName: 'Ethan',
      signupUrl: ''
    },
    createdAt: new Date('2026-07-01T12:00:00.000Z'),
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    hidden: false,
    ...overrides
  };
}

const homeModel = {
  teams: [
    { teamId: 'team-1', teamName: 'Rockets', role: 'Admin', sport: 'Basketball', state: 'OH', players: [], nextEvent: null, eventCount: 0, unreadCount: 0, openActions: 0 }
  ],
  players: [
    { playerId: 'player-1', playerName: 'Ethan Smith', teamId: 'team-1', teamName: 'Rockets', rsvpNeeded: 0, packetsReady: 0, openAssignments: 0, unreadCount: 0, nextEvent: null }
  ],
  upcomingEvents: []
};

function renderOpportunities(initialEntry = '/opportunities') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Opportunities auth={auth} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  matchingServiceMocks.loadOpenMatchingPosts.mockResolvedValue([matchingPost()]);
  matchingServiceMocks.loadMyMatchingPosts.mockResolvedValue([]);
  homeServiceMocks.loadParentHome.mockResolvedValue(homeModel);
});

afterEach(() => {
  cleanup();
});

describe('Opportunities page', () => {
  it('renders open matching posts with a respond action', async () => {
    await act(async () => {
      renderOpportunities();
    });
    expect(await screen.findByText('Ethan (U12 Soccer) is looking for a team')).toBeTruthy();
    expect(screen.getByText(/Posted by Author One/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /I'm interested/ })).toBeTruthy();
  });

  it('hides the respond action on the user\'s own post', async () => {
    matchingServiceMocks.loadOpenMatchingPosts.mockResolvedValue([matchingPost({ authorId: auth.user!.uid })]);
    await act(async () => {
      renderOpportunities();
    });
    await screen.findByText('Ethan (U12 Soccer) is looking for a team');
    expect(screen.queryByRole('button', { name: /I'm interested/ })).toBeNull();
    expect(screen.getByText('Your post')).toBeTruthy();
  });

  it.each(['Parent', 'Coach', 'Team', 'Unknown'])('hides player-post responses for the non-admin %s role', async (role) => {
    homeServiceMocks.loadParentHome.mockResolvedValue({
      ...homeModel,
      teams: [{ ...homeModel.teams[0], role }]
    });
    await act(async () => {
      renderOpportunities();
    });
    await screen.findByText('Ethan (U12 Soccer) is looking for a team');
    expect(screen.queryByRole('button', { name: /I'm interested/ })).toBeNull();
  });

  it('filters posts by kind', async () => {
    matchingServiceMocks.loadOpenMatchingPosts.mockResolvedValue([
      matchingPost(),
      matchingPost({
        id: 'post-2',
        kind: 'team_seeking_players',
        title: 'Rockets (U14 Basketball) is looking for players',
        teamId: 'team-2',
        teamName: 'Rockets',
        matching: { ...matchingPost().matching, kind: 'team_seeking_players', sport: 'Basketball', ageGroup: 'U14', playerFirstName: '' }
      })
    ]);
    await act(async () => {
      renderOpportunities();
    });
    await screen.findByText('Ethan (U12 Soccer) is looking for a team');
    fireEvent.click(screen.getByRole('button', { name: 'Teams seeking players' }));
    await waitFor(() => {
      expect(screen.queryByText('Ethan (U12 Soccer) is looking for a team')).toBeNull();
    });
    expect(screen.getByText('Rockets (U14 Basketball) is looking for players')).toBeTruthy();
  });

  it('opens the player composer from the compose query param with a privacy notice', async () => {
    await act(async () => {
      renderOpportunities('/opportunities?compose=player_seeking_team');
    });
    expect(await screen.findByText(/attributed to you/i)).toBeTruthy();
    expect(screen.getByText(/first name only/i)).toBeTruthy();
    expect(screen.getByText('Prefill from a linked player (optional)')).toBeTruthy();
  });

  it('submits a response through the respond modal', async () => {
    matchingServiceMocks.respondToMatchingPost.mockResolvedValue(undefined);
    await act(async () => {
      renderOpportunities();
    });
    fireEvent.click(await screen.findByRole('button', { name: /I'm interested/ }));
    const message = await screen.findByPlaceholderText(/Introduce yourself/);
    fireEvent.change(message, { target: { value: 'We would love a tryout.' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Send response/ }));
    });
    await waitFor(() => {
      expect(matchingServiceMocks.respondToMatchingPost).toHaveBeenCalledTimes(1);
    });
    const [, post, input] = matchingServiceMocks.respondToMatchingPost.mock.calls[0];
    expect(post.id).toBe('post-1');
    expect(input.message).toBe('We would love a tryout.');
    expect(input.teamId).toBe('team-1');
    expect(await screen.findByText(/Response sent/)).toBeTruthy();
  });

  it('shows my posts with lifecycle controls and responses', async () => {
    matchingServiceMocks.loadMyMatchingPosts.mockResolvedValue([matchingPost({ authorId: auth.user!.uid })]);
    matchingServiceMocks.loadMatchingResponses.mockResolvedValue([
      {
        id: 'responder-1',
        responderId: 'responder-1',
        responderName: 'Coach Kim',
        responderPhotoUrl: null,
        teamId: 'team-2',
        teamName: 'Comets',
        message: 'We have a spot open.',
        createdAt: new Date('2026-07-05T12:00:00.000Z')
      }
    ]);
    matchingServiceMocks.setMatchingPostStatus.mockResolvedValue(undefined);

    await act(async () => {
      renderOpportunities('/opportunities?view=mine');
    });
    expect(await screen.findByRole('button', { name: /Mark filled/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /View responses/ }));
    expect(await screen.findByText('Coach Kim')).toBeTruthy();
    expect(screen.getByText('We have a spot open.')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Mark filled/ }));
    });
    await waitFor(() => {
      expect(matchingServiceMocks.setMatchingPostStatus).toHaveBeenCalledWith('post-1', 'filled');
    });
  });
});
