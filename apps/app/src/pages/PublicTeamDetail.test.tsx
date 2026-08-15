// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicTeamDetail } from './PublicTeamDetail';

const publicTeamMocks = vi.hoisted(() => ({
  getPublicTeamDetail: vi.fn(),
  getPublicTeamResults: vi.fn()
}));
vi.mock('../lib/publicTeamsService', () => publicTeamMocks);
vi.mock('lucide-react', () => {
  const Icon = () => null;
  return { BarChart3: Icon, Loader2: Icon, MapPin: Icon, RotateCcw: Icon, Shield: Icon, ShieldCheck: Icon, Trophy: Icon, Users: Icon };
});

afterEach(() => cleanup());

describe('PublicTeamDetail', () => {
  beforeEach(() => {
    publicTeamMocks.getPublicTeamDetail.mockReset();
    publicTeamMocks.getPublicTeamResults.mockReset();
    publicTeamMocks.getPublicTeamResults.mockResolvedValue({
      standings: { enabled: false, label: 'No standings configured', rows: [], currentRow: null },
      recentResults: []
    });
  });

  it('announces loading while the public team request is pending', () => {
    publicTeamMocks.getPublicTeamDetail.mockImplementation(() => new Promise(() => {}));

    render(<MemoryRouter initialEntries={['/teams/team-1/public']}><Routes><Route path="/teams/:teamId/public" element={<PublicTeamDetail authUser={null} />} /></Routes></MemoryRouter>);

    expect(screen.getByRole('status').textContent).toContain('Loading public team');
  });

  it('renders an allow-listed public team profile without private collections', async () => {
    publicTeamMocks.getPublicTeamDetail.mockResolvedValue({
      id: 'team-1',
      name: 'Austin Bats',
      sport: 'Baseball',
      description: 'Community baseball team.',
      photoUrl: null,
      city: 'Austin',
      state: 'TX',
      zip: '78701',
      location: 'Austin, TX'
    });

    render(<MemoryRouter initialEntries={['/teams/team-1/public']}><Routes><Route path="/teams/:teamId/public" element={<PublicTeamDetail authUser={null} />} /></Routes></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Austin Bats' })).toBeTruthy();
    expect(screen.getByText('Public-safe profile')).toBeTruthy();
    expect(screen.getByText('Community baseball team.')).toBeTruthy();
    expect(publicTeamMocks.getPublicTeamDetail).toHaveBeenCalledWith('team-1');
    expect(screen.getByRole('link', { name: 'Back to team search' }).getAttribute('href')).toBe('/teams/browse');
    expect(screen.getByRole('link', { name: 'Enter a join code' }).getAttribute('href')).toBe('/accept-invite');
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/auth');
  });

  it('hides the sign-in action from authenticated visitors', async () => {
    publicTeamMocks.getPublicTeamDetail.mockResolvedValue({
      id: 'team-1',
      name: 'Austin Bats',
      sport: 'Baseball',
      description: 'Community baseball team.',
      photoUrl: null,
      city: 'Austin',
      state: 'TX',
      zip: '78701',
      location: 'Austin, TX'
    });

    const authUser = { uid: 'parent-1', email: 'parent@example.com', displayName: 'Parent', roles: ['parent' as const] };
    render(<MemoryRouter initialEntries={['/teams/team-1/public']}><Routes><Route path="/teams/:teamId/public" element={<PublicTeamDetail authUser={authUser} />} /></Routes></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Austin Bats' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
  });

  it('provides recovery actions and retries the same public team', async () => {
    publicTeamMocks.getPublicTeamDetail
      .mockRejectedValueOnce(new Error('Public team could not load.'))
      .mockResolvedValueOnce({
        id: 'team-1',
        name: 'Austin Bats',
        sport: 'Baseball',
        description: 'Community baseball team.',
        photoUrl: null,
        city: 'Austin',
        state: 'TX',
        zip: '78701',
        location: 'Austin, TX'
      });

    render(<MemoryRouter initialEntries={['/teams/team-1/public']}><Routes><Route path="/teams/:teamId/public" element={<PublicTeamDetail authUser={null} />} /></Routes></MemoryRouter>);

    expect(await screen.findByText('Public team could not load.')).toBeTruthy();
    const backLink = screen.getByRole('link', { name: 'Back to team search' });
    expect(backLink.getAttribute('href')).toBe('/teams/browse');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(screen.getByRole('status').textContent).toContain('Loading public team');
    expect(await screen.findByRole('heading', { name: 'Austin Bats' })).toBeTruthy();
    await waitFor(() => expect(publicTeamMocks.getPublicTeamDetail).toHaveBeenCalledTimes(2));
    expect(publicTeamMocks.getPublicTeamDetail).toHaveBeenNthCalledWith(2, 'team-1');
    expect(screen.queryByText('Public team could not load.')).toBeNull();
  });

  it('clears the prior public team when a new route fails to load', async () => {
    publicTeamMocks.getPublicTeamDetail.mockImplementation((teamId: string) => teamId === 'team-1'
      ? Promise.resolve({
        id: 'team-1',
        name: 'Austin Bats',
        sport: 'Baseball',
        description: 'Community baseball team.',
        photoUrl: null,
        city: 'Austin',
        state: 'TX',
        zip: '78701',
        location: 'Austin, TX'
      })
      : Promise.reject(new Error('Public team not found.')));

    render(
      <MemoryRouter initialEntries={['/teams/team-1/public']}>
        <Link to="/teams/missing/public">Next team</Link>
        <Routes><Route path="/teams/:teamId/public" element={<PublicTeamDetail authUser={null} />} /></Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Austin Bats' })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Next team' }));
    expect(await screen.findByText('Public team not found.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Austin Bats' })).toBeNull();
  });

  it('renders responsive configured standings with the current team highlighted and bounded finals', async () => {
    publicTeamMocks.getPublicTeamDetail.mockResolvedValue({
      id: 'team-1',
      name: 'Austin Bats',
      sport: 'Baseball',
      description: 'Community baseball team.',
      photoUrl: null,
      city: 'Austin',
      state: 'TX',
      zip: '78701',
      location: 'Austin, TX',
      leagueUrl: 'https://league.example.test/standings',
      standingsConfig: { enabled: true, rankingMode: 'points' }
    });
    publicTeamMocks.getPublicTeamResults.mockResolvedValue({
      standings: {
        enabled: true,
        label: 'Points table',
        rows: [
          { rank: 1, teamId: 'team-owls', team: 'Owls', isCurrentTeam: false, record: '4-1', points: 12 },
          { rank: 2, teamId: 'team-1', team: 'Austin Bats', isCurrentTeam: true, record: '3-2', points: 9 }
        ],
        currentRow: { rank: 2, teamId: 'team-1', team: 'Austin Bats', isCurrentTeam: true, record: '3-2', points: 9 }
      },
      recentResults: [
        { id: 'game-2', date: new Date('2026-08-12T18:00:00.000Z'), opponent: 'Owls', teamScore: 5, opponentScore: 3, result: 'Win' },
        { id: 'game-1', date: new Date('2026-08-05T18:00:00.000Z'), opponent: 'Foxes', teamScore: 1, opponentScore: 2, result: 'Loss' }
      ]
    });

    render(<MemoryRouter initialEntries={['/teams/team-1/public']}><Routes><Route path="/teams/:teamId/public" element={<PublicTeamDetail authUser={null} />} /></Routes></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Austin Bats' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Standings' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'PTS' })).toBeTruthy();
    const currentRow = screen.getByRole('row', { name: /#2 Austin Bats 3-2 9/ });
    expect(currentRow.getAttribute('aria-current')).toBe('true');
    expect(currentRow.className).toContain('bg-primary-50');
    const table = screen.getByRole('table');
    expect(table.parentElement?.className).toContain('overflow-x-auto');
    expect(screen.getByText('vs. Owls')).toBeTruthy();
    expect(screen.getByText('Aug 12, 2026')).toBeTruthy();
    expect(screen.getByText('5 - 3')).toBeTruthy();
    expect(screen.getByText('Win')).toBeTruthy();
    expect(screen.getByText('vs. Foxes')).toBeTruthy();
    expect(screen.getByText('Loss')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'League standings' }).getAttribute('href')).toBe('https://league.example.test/standings');
    expect(screen.getByRole('link', { name: 'League standings' }).getAttribute('target')).toBe('_blank');
    expect(screen.getByRole('link', { name: 'League standings' }).getAttribute('rel')).toContain('noreferrer');
    expect(publicTeamMocks.getPublicTeamResults).toHaveBeenCalledWith(expect.objectContaining({ id: 'team-1' }));
    expect(screen.getByText(/Public final scores and standings are loaded/)).toBeTruthy();
  });

  it('highlights only the current team when league teams share a display name', async () => {
    publicTeamMocks.getPublicTeamDetail.mockResolvedValue({
      id: 'team-1',
      name: 'United',
      sport: 'Soccer',
      description: null,
      photoUrl: null,
      city: null,
      state: null,
      zip: null,
      location: null,
      leagueUrl: null,
      standingsConfig: { enabled: true, rankingMode: 'points' }
    });
    const currentRow = { rank: 2, teamId: 'team-1', team: 'United', isCurrentTeam: true, record: '2-1', points: 6 };
    publicTeamMocks.getPublicTeamResults.mockResolvedValue({
      standings: {
        enabled: true,
        label: 'Points table',
        rows: [
          { rank: 1, teamId: 'team-2', team: 'United', isCurrentTeam: false, record: '3-0', points: 9 },
          currentRow
        ],
        currentRow
      },
      recentResults: []
    });

    render(<MemoryRouter initialEntries={['/teams/team-1/public']}><Routes><Route path="/teams/:teamId/public" element={<PublicTeamDetail authUser={null} />} /></Routes></MemoryRouter>);

    const duplicateNameRows = await screen.findAllByRole('row', { name: /United/ });
    expect(duplicateNameRows).toHaveLength(2);
    expect(duplicateNameRows[0].getAttribute('aria-current')).toBeNull();
    expect(duplicateNameRows[1].getAttribute('aria-current')).toBe('true');
  });

  it('renders win percentage standings and a useful league fallback when rows are unavailable', async () => {
    publicTeamMocks.getPublicTeamDetail.mockResolvedValue({
      id: 'team-1',
      name: 'Austin Bats',
      sport: 'Baseball',
      description: null,
      photoUrl: null,
      city: null,
      state: null,
      zip: null,
      location: null,
      leagueUrl: 'https://league.example.test/standings',
      standingsConfig: { enabled: true, rankingMode: 'win_pct' }
    });
    publicTeamMocks.getPublicTeamResults.mockResolvedValue({
      standings: { enabled: true, label: 'Win percentage', rows: [], currentRow: null },
      recentResults: []
    });

    render(<MemoryRouter initialEntries={['/teams/team-1/public']}><Routes><Route path="/teams/:teamId/public" element={<PublicTeamDetail authUser={null} />} /></Routes></MemoryRouter>);

    expect(await screen.findByText('No completed public games are available for standings yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'League standings' })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('No recent final scores are available yet.')).toBeTruthy();
  });

  it('keeps public identity visible and retries an unavailable results projection', async () => {
    publicTeamMocks.getPublicTeamDetail.mockResolvedValue({
      id: 'team-1',
      name: 'Austin Bats',
      sport: 'Baseball',
      description: null,
      photoUrl: null,
      city: null,
      state: null,
      zip: null,
      location: null,
      leagueUrl: null,
      standingsConfig: { enabled: true, rankingMode: 'points' }
    });
    publicTeamMocks.getPublicTeamResults
      .mockRejectedValueOnce(new Error('Unable to load complete public results.'))
      .mockResolvedValueOnce({
        standings: {
          enabled: true,
          label: 'Points table',
          rows: [{ rank: 1, teamId: 'team-1', team: 'Austin Bats', isCurrentTeam: true, record: '1-0', points: 3 }],
          currentRow: { rank: 1, teamId: 'team-1', team: 'Austin Bats', isCurrentTeam: true, record: '1-0', points: 3 }
        },
        recentResults: []
      });

    render(<MemoryRouter initialEntries={['/teams/team-1/public']}><Routes><Route path="/teams/:teamId/public" element={<PublicTeamDetail authUser={null} />} /></Routes></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Austin Bats' })).toBeTruthy();
    expect(await screen.findByText('Unable to load complete public results.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry results' }));
    expect(await screen.findByRole('table')).toBeTruthy();
    await waitFor(() => expect(publicTeamMocks.getPublicTeamResults).toHaveBeenCalledTimes(2));
    expect(publicTeamMocks.getPublicTeamDetail).toHaveBeenCalledTimes(1);
  });
});
