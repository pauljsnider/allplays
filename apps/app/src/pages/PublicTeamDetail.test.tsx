// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicTeamDetail } from './PublicTeamDetail';

const publicTeamMocks = vi.hoisted(() => ({
  getPublicTeamDetail: vi.fn(),
  getPublicTeamStandingsInputs: vi.fn()
}));
const standingsMocks = vi.hoisted(() => ({ computeNativeStandings: vi.fn() }));
vi.mock('../lib/publicTeamsService', () => publicTeamMocks);
vi.mock('../lib/adapters/legacyPublicTeamsDb', () => standingsMocks);
vi.mock('lucide-react', () => {
  const Icon = () => null;
  return { BarChart3: Icon, Loader2: Icon, MapPin: Icon, Shield: Icon, ShieldCheck: Icon, Users: Icon };
});

afterEach(() => cleanup());

describe('PublicTeamDetail', () => {
  beforeEach(() => {
    publicTeamMocks.getPublicTeamDetail.mockReset();
    publicTeamMocks.getPublicTeamStandingsInputs.mockReset();
    standingsMocks.computeNativeStandings.mockReset();
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

  it('renders configured native standings for anonymous visitors and highlights the current team', async () => {
    const standingsConfig = {
      enabled: true,
      rankingMode: 'points' as const,
      points: { win: 4, tie: 2, loss: 1 },
      maxGoalDiff: 5,
      tiebreakers: ['wins', 'point_diff'],
      twoTeamTiebreakers: ['head_to_head', 'point_diff'],
      multiTeamTiebreakers: ['group_head_to_head', 'points_for']
    };
    const games = [{
      id: 'game-1',
      date: new Date('2026-08-10T18:00:00.000Z'),
      homeTeam: 'Austin Bats',
      awayTeam: 'Round Rock Owls',
      homeScore: 7,
      awayScore: 4,
      status: 'completed'
    }];
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
      standingsConfig
    });
    publicTeamMocks.getPublicTeamStandingsInputs.mockResolvedValue(games);
    standingsMocks.computeNativeStandings.mockReturnValue([
      { team: 'Round Rock Owls', rank: 1, record: '3-0', points: 12, winPct: 1 },
      { team: 'Austin Bats', rank: 2, record: '2-1', points: 9, winPct: 0.667 }
    ]);

    render(<MemoryRouter initialEntries={['/teams/team-1/public']}><Routes><Route path="/teams/:teamId/public" element={<PublicTeamDetail authUser={null} />} /></Routes></MemoryRouter>);

    const table = await screen.findByRole('table', { name: 'Standings' });
    expect(publicTeamMocks.getPublicTeamStandingsInputs).toHaveBeenCalledWith('team-1');
    expect(standingsMocks.computeNativeStandings).toHaveBeenCalledWith(games, standingsConfig);
    expect(within(table).getByRole('columnheader', { name: 'PTS' })).toBeTruthy();
    expect(table.className).toContain('table-fixed');
    expect(table.className).toContain('w-full');

    const currentTeamCell = within(table).getByText('Austin Bats');
    const currentTeamRow = currentTeamCell.closest('tr');
    expect(currentTeamRow?.getAttribute('aria-current')).toBe('true');
    expect(currentTeamRow?.className).toContain('bg-primary-50');
    expect(currentTeamCell.closest('td')?.className).toContain('break-words');
    expect(within(currentTeamRow as HTMLElement).getByText('9')).toBeTruthy();

    const otherTeamRow = within(table).getByText('Round Rock Owls').closest('tr');
    expect(otherTeamRow?.hasAttribute('aria-current')).toBe(false);
    const leagueLink = screen.getByRole('link', { name: 'League page' });
    expect(leagueLink.getAttribute('href')).toBe('https://league.example.test/standings');
    expect(leagueLink.getAttribute('target')).toBe('_blank');
    expect(leagueLink.getAttribute('rel')).toBe('noreferrer');
  });

  it('renders win percentage in the configured metric column', async () => {
    publicTeamMocks.getPublicTeamDetail.mockResolvedValue({
      id: 'team-1',
      name: 'Austin Bats',
      sport: 'Baseball',
      description: null,
      photoUrl: null,
      city: 'Austin',
      state: 'TX',
      zip: null,
      location: 'Austin, TX',
      leagueUrl: null,
      standingsConfig: {
        enabled: true,
        rankingMode: 'win_pct',
        points: { win: 3, tie: 1, loss: 0 },
        maxGoalDiff: null,
        tiebreakers: [],
        twoTeamTiebreakers: [],
        multiTeamTiebreakers: []
      }
    });
    publicTeamMocks.getPublicTeamStandingsInputs.mockResolvedValue([{ id: 'game-1' }]);
    standingsMocks.computeNativeStandings.mockReturnValue([
      { team: 'Austin Bats', rank: 1, record: '2-1-1', points: 7, winPct: 0.625 }
    ]);

    render(<MemoryRouter initialEntries={['/teams/team-1/public']}><Routes><Route path="/teams/:teamId/public" element={<PublicTeamDetail authUser={null} />} /></Routes></MemoryRouter>);

    const table = await screen.findByRole('table', { name: 'Standings' });
    expect(within(table).getByRole('columnheader', { name: 'PCT' })).toBeTruthy();
    expect(within(table).getByText('0.625')).toBeTruthy();
  });

  it('keeps the public profile visible when standings are unavailable and links the league page', async () => {
    publicTeamMocks.getPublicTeamDetail.mockResolvedValue({
      id: 'team-1',
      name: 'Austin Bats',
      sport: 'Baseball',
      description: 'Community baseball team.',
      photoUrl: null,
      city: 'Austin',
      state: 'TX',
      zip: null,
      location: 'Austin, TX',
      leagueUrl: 'https://league.example.test/standings',
      standingsConfig: {
        enabled: true,
        rankingMode: 'points',
        points: null,
        maxGoalDiff: null,
        tiebreakers: [],
        twoTeamTiebreakers: [],
        multiTeamTiebreakers: []
      }
    });
    publicTeamMocks.getPublicTeamStandingsInputs.mockRejectedValue(new Error('Projection unavailable.'));

    render(<MemoryRouter initialEntries={['/teams/team-1/public']}><Routes><Route path="/teams/:teamId/public" element={<PublicTeamDetail authUser={null} />} /></Routes></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Austin Bats' })).toBeTruthy();
    expect(await screen.findByText('Standings are temporarily unavailable.')).toBeTruthy();
    expect(screen.getByText('Community baseball team.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'League page' }).getAttribute('href')).toBe('https://league.example.test/standings');
    expect(standingsMocks.computeNativeStandings).not.toHaveBeenCalled();
  });

  it('shows an empty state when enabled standings have no qualifying completed games', async () => {
    publicTeamMocks.getPublicTeamDetail.mockResolvedValue({
      id: 'team-1',
      name: 'Austin Bats',
      sport: 'Baseball',
      description: null,
      photoUrl: null,
      city: 'Austin',
      state: 'TX',
      zip: null,
      location: 'Austin, TX',
      leagueUrl: null,
      standingsConfig: {
        enabled: true,
        rankingMode: 'points',
        points: null,
        maxGoalDiff: null,
        tiebreakers: [],
        twoTeamTiebreakers: [],
        multiTeamTiebreakers: []
      }
    });
    publicTeamMocks.getPublicTeamStandingsInputs.mockResolvedValue([]);
    standingsMocks.computeNativeStandings.mockReturnValue([]);

    render(<MemoryRouter initialEntries={['/teams/team-1/public']}><Routes><Route path="/teams/:teamId/public" element={<PublicTeamDetail authUser={null} />} /></Routes></MemoryRouter>);

    expect(await screen.findByText('No completed public games are available for standings yet.')).toBeTruthy();
    expect(standingsMocks.computeNativeStandings).toHaveBeenCalledWith([], expect.objectContaining({ enabled: true }));
  });

  it('shows a useful disabled state without requesting public games', async () => {
    publicTeamMocks.getPublicTeamDetail.mockResolvedValue({
      id: 'team-1',
      name: 'Austin Bats',
      sport: 'Baseball',
      description: null,
      photoUrl: null,
      city: 'Austin',
      state: 'TX',
      zip: null,
      location: 'Austin, TX',
      leagueUrl: null,
      standingsConfig: {
        enabled: false,
        rankingMode: 'points',
        points: null,
        maxGoalDiff: null,
        tiebreakers: [],
        twoTeamTiebreakers: [],
        multiTeamTiebreakers: []
      }
    });

    render(<MemoryRouter initialEntries={['/teams/team-1/public']}><Routes><Route path="/teams/:teamId/public" element={<PublicTeamDetail authUser={null} />} /></Routes></MemoryRouter>);

    expect(await screen.findByText('In-app standings are not enabled for this team.')).toBeTruthy();
    expect(publicTeamMocks.getPublicTeamStandingsInputs).not.toHaveBeenCalled();
    expect(standingsMocks.computeNativeStandings).not.toHaveBeenCalled();
  });
});
