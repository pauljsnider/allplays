// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FamilyShare } from './FamilyShare';
import { FamilyShareTokenError } from '../lib/familyShareViewerService';

const familyShareMocks = vi.hoisted(() => ({
  loadFamilyShareView: vi.fn(),
  resolveFamilyShareWatchCta: vi.fn()
}));

vi.mock('../lib/familyShareViewerService', () => {
  class FamilyShareTokenError extends Error {
    reason: string;

    constructor(reason: string, message: string) {
      super(message);
      this.name = 'FamilyShareTokenError';
      this.reason = reason;
    }
  }

  return {
    FamilyShareTokenError,
    isFamilyShareCompletedGame: (event: { status?: string; liveStatus?: string | null; isCancelled?: boolean }) => {
      if (event.isCancelled) return false;
      const status = event.status || '';
      const liveStatus = event.liveStatus || '';
      return ((status === 'completed' || status === 'final')
          && (!liveStatus || liveStatus === 'completed' || liveStatus === 'final' || liveStatus === 'scheduled'))
        || (!status && (liveStatus === 'completed' || liveStatus === 'final'));
    },
    loadFamilyShareView: familyShareMocks.loadFamilyShareView,
    resolveFamilyShareWatchCta: familyShareMocks.resolveFamilyShareWatchCta
  };
});

vi.mock('lucide-react', () => {
  const Icon = () => null;
  return {
    AlertCircle: Icon,
    CalendarDays: Icon,
    Loader2: Icon,
    MapPin: Icon,
    PlayCircle: Icon,
    Radio: Icon,
    RefreshCw: Icon,
    ShieldCheck: Icon,
    Trophy: Icon,
    Users: Icon
  };
});

afterEach(() => {
  cleanup();
  familyShareMocks.loadFamilyShareView.mockReset();
  familyShareMocks.resolveFamilyShareWatchCta.mockReset();
});

describe('FamilyShare', () => {
  it('renders children, upcoming events, and recent results from a token without auth', async () => {
    familyShareMocks.loadFamilyShareView.mockResolvedValue({
      tokenId: 'token-1',
      label: 'Grandma schedule',
      expiresAt: null,
      children: [
        { teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Sam Player', playerNumber: '12', playerPhotoUrl: null }
      ],
      teams: [
        { teamId: 'team-1', teamName: 'Bears', playerNames: ['Sam Player'] }
      ],
      events: [],
      upcomingEvents: [
        {
          eventKey: 'team-1:game-1',
          id: 'game-1',
          teamId: 'team-1',
          teamName: 'Bears',
          type: 'game',
          date: new Date('2026-07-13T18:00:00Z'),
          title: '',
          opponent: 'Tigers',
          location: 'Field 1',
          status: 'scheduled',
          isCancelled: false,
          isDbGame: true,
          childIds: ['player-1'],
          childNames: ['Sam Player'],
          homeScore: null,
          awayScore: null
        }
      ],
      recentResults: [
        {
          eventKey: 'team-1:game-0',
          id: 'game-0',
          teamId: 'team-1',
          teamName: 'Bears',
          type: 'game',
          date: new Date('2026-07-08T18:00:00Z'),
          title: '',
          opponent: 'Owls',
          location: 'Field 2',
          status: 'final',
          isCancelled: false,
          isDbGame: true,
          childIds: ['player-1'],
          childNames: ['Sam Player'],
          homeScore: 4,
          awayScore: 2
        }
      ],
      calendarWarnings: []
    });

    render(<MemoryRouter initialEntries={['/family/token-1']}><Routes><Route path="/family/:token" element={<FamilyShare />} /></Routes></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Grandma schedule' })).toBeTruthy();
    expect(screen.getAllByText(/Sam Player/).length).toBeGreaterThan(0);
    expect(screen.getByText('vs Tigers')).toBeTruthy();
    expect(screen.getByText('vs Owls')).toBeTruthy();
    expect(screen.getByText('Final 4-2')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /watch replay/i })).toBeNull();
    expect(familyShareMocks.loadFamilyShareView).toHaveBeenCalledWith('token-1');
  });

  it('renders server-approved live and replay actions as public live-game links', async () => {
    const liveEvent = {
      eventKey: 'team-1:game-live',
      id: 'game-live',
      teamId: 'team-1',
      teamName: 'Bears',
      type: 'game',
      date: new Date('2026-07-13T18:00:00Z'),
      title: '',
      opponent: 'Tigers',
      location: 'Field 1',
      status: 'scheduled',
      liveStatus: 'live',
      isCancelled: false,
      isDbGame: true,
      hasReplayVideo: false,
      canOpenPublicViewer: true,
      childIds: [],
      childNames: [],
      homeScore: 0,
      awayScore: 0
    } as const;
    const replayEvent = {
      ...liveEvent,
      eventKey: 'team-1:game-replay',
      id: 'game-replay',
      date: new Date('2026-07-08T18:00:00Z'),
      opponent: 'Owls',
      status: 'completed',
      liveStatus: 'scheduled',
      hasReplayVideo: true,
      homeScore: 4,
      awayScore: 2
    } as const;
    familyShareMocks.resolveFamilyShareWatchCta.mockImplementation((event) => event.id === 'game-live'
      ? {
          kind: 'live',
          label: 'Watch Live',
          href: 'https://allplays.ai/live-game.html?teamId=team-1&gameId=game-live'
        }
      : {
          kind: 'replay',
          label: 'Watch Replay',
          href: 'https://allplays.ai/live-game.html?teamId=team-1&gameId=game-replay&replay=true'
        });
    familyShareMocks.loadFamilyShareView.mockResolvedValue({
      tokenId: 'token-1',
      label: 'Grandma schedule',
      expiresAt: null,
      children: [],
      teams: [],
      events: [liveEvent, replayEvent],
      upcomingEvents: [liveEvent],
      recentResults: [replayEvent],
      calendarWarnings: []
    });

    render(<MemoryRouter initialEntries={['/family/token-1']}><Routes><Route path="/family/:token" element={<FamilyShare />} /></Routes></MemoryRouter>);

    const liveLink = await screen.findByRole('link', { name: 'Watch Live: vs Tigers' });
    const replayLink = screen.getByRole('link', { name: 'Watch Replay: vs Owls' });
    expect(liveLink.getAttribute('href')).toBe('https://allplays.ai/live-game.html?teamId=team-1&gameId=game-live');
    expect(replayLink.getAttribute('href')).toBe('https://allplays.ai/live-game.html?teamId=team-1&gameId=game-replay&replay=true');
    expect(liveLink.getAttribute('rel')).toBe('noopener noreferrer');
    expect(replayLink.getAttribute('target')).toBe('_blank');
    expect(screen.queryByText('Final 0-0')).toBeNull();
  });

  it.each(['cancelled', 'canceled'])('does not label a %s result with retained scores as final', async (liveStatus) => {
    const cancelledEvent = {
      eventKey: `team-1:game-${liveStatus}`,
      id: `game-${liveStatus}`,
      teamId: 'team-1',
      teamName: 'Bears',
      type: 'game',
      date: new Date('2026-07-08T18:00:00Z'),
      title: '',
      opponent: 'Owls',
      location: 'Field 2',
      status: 'scheduled',
      liveStatus,
      isCancelled: true,
      isDbGame: true,
      hasReplayVideo: false,
      canOpenPublicViewer: false,
      childIds: [],
      childNames: [],
      homeScore: 0,
      awayScore: 0
    } as const;
    familyShareMocks.loadFamilyShareView.mockResolvedValue({
      tokenId: 'token-1',
      label: 'Grandma schedule',
      expiresAt: null,
      children: [],
      teams: [],
      events: [cancelledEvent],
      upcomingEvents: [],
      recentResults: [cancelledEvent],
      calendarWarnings: []
    });

    render(<MemoryRouter initialEntries={['/family/token-1']}><Routes><Route path="/family/:token" element={<FamilyShare />} /></Routes></MemoryRouter>);

    expect(await screen.findByText('Cancelled')).toBeTruthy();
    expect(screen.queryByText('Final 0-0')).toBeNull();
  });

  it('shows the expired-token error state instead of redirecting to auth', async () => {
    familyShareMocks.loadFamilyShareView.mockRejectedValue(new FamilyShareTokenError('expired', 'Expired'));

    render(<MemoryRouter initialEntries={['/family/expired-token']}><Routes><Route path="/family/:token" element={<FamilyShare />} /></Routes></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'This link has expired' })).toBeTruthy();
    expect(screen.getByText('Ask the parent to create a new family share link. Expired links never load player, team, or schedule details.')).toBeTruthy();
  });

  it('shows a retryable throttled state instead of an empty family schedule', async () => {
    const throttledError = new FamilyShareTokenError('throttled', 'Busy');
    Object.assign(throttledError, { retryAfterSeconds: 42 });
    familyShareMocks.loadFamilyShareView.mockRejectedValue(throttledError);

    render(<MemoryRouter initialEntries={['/family/throttled-token']}><Routes><Route path="/family/:token" element={<FamilyShare />} /></Routes></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Family page temporarily busy' })).toBeTruthy();
    expect(screen.getByText('Please wait about 42 seconds, then retry.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry family page' })).toBeTruthy();
    expect(screen.queryByText('No upcoming events')).toBeNull();
  });
});
