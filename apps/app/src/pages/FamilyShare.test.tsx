// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FamilyShare } from './FamilyShare';
import { FamilyShareTokenError } from '../lib/familyShareViewerService';

const familyShareMocks = vi.hoisted(() => ({
  loadFamilyShareView: vi.fn()
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
    loadFamilyShareView: familyShareMocks.loadFamilyShareView
  };
});

vi.mock('lucide-react', () => {
  const Icon = () => null;
  return {
    AlertCircle: Icon,
    CalendarDays: Icon,
    Loader2: Icon,
    MapPin: Icon,
    RefreshCw: Icon,
    ShieldCheck: Icon,
    Trophy: Icon,
    Users: Icon
  };
});

afterEach(() => {
  cleanup();
  familyShareMocks.loadFamilyShareView.mockReset();
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
    expect(familyShareMocks.loadFamilyShareView).toHaveBeenCalledWith('token-1');
  });

  it('shows the expired-token error state instead of redirecting to auth', async () => {
    familyShareMocks.loadFamilyShareView.mockRejectedValue(new FamilyShareTokenError('expired', 'Expired'));

    render(<MemoryRouter initialEntries={['/family/expired-token']}><Routes><Route path="/family/:token" element={<FamilyShare />} /></Routes></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'This link has expired' })).toBeTruthy();
    expect(screen.getByText('Ask the parent to create a new family share link. Expired links never load player, team, or schedule details.')).toBeTruthy();
  });
});
