// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicTeamDetail } from './PublicTeamDetail';

const publicTeamMocks = vi.hoisted(() => ({ getPublicTeamDetail: vi.fn(), getPublicTeamRecentResults: vi.fn() }));
vi.mock('../lib/publicTeamsService', () => publicTeamMocks);
vi.mock('lucide-react', () => {
  const Icon = () => null;
  return { Loader2: Icon, MapPin: Icon, Shield: Icon, ShieldCheck: Icon, Users: Icon };
});

afterEach(() => cleanup());

describe('PublicTeamDetail', () => {
  beforeEach(() => {
    publicTeamMocks.getPublicTeamDetail.mockReset();
    publicTeamMocks.getPublicTeamRecentResults.mockReset();
    publicTeamMocks.getPublicTeamRecentResults.mockResolvedValue([]);
  });

  it('shows the standings loading state while the public team request is pending', () => {
    publicTeamMocks.getPublicTeamDetail.mockImplementation(() => new Promise(() => {}));

    render(<MemoryRouter initialEntries={['/teams/team-1/public']}><Routes><Route path="/teams/:teamId/public" element={<PublicTeamDetail authUser={null} />} /></Routes></MemoryRouter>);

    expect(screen.getByRole('status').textContent).toContain('Loading public team');
    expect(screen.getByText('Loading standings')).toBeTruthy();
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

  it('renders recent public results with opponent, date, score, and team-perspective result', async () => {
    publicTeamMocks.getPublicTeamDetail.mockResolvedValue({
      id: 'team-1',
      name: 'Austin Bats',
      sport: 'Baseball',
      description: null,
      photoUrl: null,
      city: 'Austin',
      state: 'TX',
      zip: '78701',
      location: 'Austin, TX'
    });
    publicTeamMocks.getPublicTeamRecentResults.mockResolvedValue([
      { id: 'game-1', date: new Date('2026-08-06T18:00:00.000Z'), opponent: 'Northside Owls', teamScore: 4, opponentScore: 1, result: 'win' },
      { id: 'game-2', date: new Date('2026-08-02T18:00:00.000Z'), opponent: 'Metro Foxes', teamScore: 2, opponentScore: 2, result: 'draw' }
    ]);

    render(<MemoryRouter initialEntries={['/teams/team-1/public']}><Routes><Route path="/teams/:teamId/public" element={<PublicTeamDetail authUser={null} />} /></Routes></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Recent results' })).toBeTruthy();
    expect(await screen.findByText('Northside Owls')).toBeTruthy();
    expect(screen.getByText('Thu, Aug 6')).toBeTruthy();
    expect(screen.getByLabelText('Final score: Austin Bats 4, Northside Owls 1')).toBeTruthy();
    expect(screen.getByText('Win')).toBeTruthy();
    expect(screen.getByText('Draw')).toBeTruthy();
    expect(publicTeamMocks.getPublicTeamRecentResults).toHaveBeenCalledWith('team-1');
  });

  it('renders populated standings rows and highlights the current team', async () => {
    const standingsRows = [
      { rank: 1, team: 'Austin Bats', w: 8, l: 1, t: 0, points: 16 },
      { rank: 2, team: 'Northside Owls', w: 7, l: 2, t: 0, points: 14 }
    ];
    publicTeamMocks.getPublicTeamDetail.mockResolvedValue({
      id: 'team-1', name: 'Austin Bats', sport: 'Baseball', description: null, photoUrl: null,
      city: 'Austin', state: 'TX', zip: '78701', location: 'Austin, TX',
      standings: { label: 'Points table', rows: standingsRows, currentRow: standingsRows[0] }
    });

    render(<MemoryRouter initialEntries={['/teams/team-1/public']}><Routes><Route path="/teams/:teamId/public" element={<PublicTeamDetail authUser={null} />} /></Routes></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Standings' })).toBeTruthy();
    expect(screen.queryByText('Loading standings')).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Rank' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Team' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Record' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'PTS' })).toBeTruthy();
    expect(screen.getByText('Northside Owls')).toBeTruthy();
    expect(screen.getByText('8-1')).toBeTruthy();
    expect(screen.getByText('16')).toBeTruthy();
    expect(screen.getAllByText('Austin Bats').find((element) => element.closest('tr')?.getAttribute('aria-current') === 'true')).toBeTruthy();
  });

  it('explains unavailable standings and links to the league when configured', async () => {
    publicTeamMocks.getPublicTeamDetail.mockResolvedValue({
      id: 'team-1', name: 'Austin Bats', sport: 'Baseball', description: null, photoUrl: null,
      city: 'Austin', state: 'TX', zip: '78701', location: 'Austin, TX', leagueUrl: 'https://league.example.test/standings', standings: null
    });

    render(<MemoryRouter initialEntries={['/teams/team-1/public']}><Routes><Route path="/teams/:teamId/public" element={<PublicTeamDetail authUser={null} />} /></Routes></MemoryRouter>);

    expect(await screen.findByText('Standings are currently unavailable')).toBeTruthy();
    const leagueLink = screen.getByRole('link', { name: 'View league standings' });
    expect(leagueLink.getAttribute('href')).toBe('https://league.example.test/standings');
    expect(leagueLink.getAttribute('target')).toBe('_blank');
  });

  it('omits the league link when standings are unavailable and no league is configured', async () => {
    publicTeamMocks.getPublicTeamDetail.mockResolvedValue({
      id: 'team-1', name: 'Austin Bats', sport: 'Baseball', description: null, photoUrl: null,
      city: 'Austin', state: 'TX', zip: '78701', location: 'Austin, TX', leagueUrl: null, standings: null
    });

    render(<MemoryRouter initialEntries={['/teams/team-1/public']}><Routes><Route path="/teams/:teamId/public" element={<PublicTeamDetail authUser={null} />} /></Routes></MemoryRouter>);

    expect(await screen.findByText('Standings are currently unavailable')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'View league standings' })).toBeNull();
  });

  it('shows an explicit empty state when there are no completed public results', async () => {
    publicTeamMocks.getPublicTeamDetail.mockResolvedValue({ id: 'team-1', name: 'Austin Bats', sport: null, description: null, photoUrl: null, city: null, state: null, zip: null, location: null });

    render(<MemoryRouter initialEntries={['/teams/team-1/public']}><Routes><Route path="/teams/:teamId/public" element={<PublicTeamDetail authUser={null} />} /></Routes></MemoryRouter>);

    expect(await screen.findByText('No recent results')).toBeTruthy();
    expect(screen.getByText('Completed public games will appear here.')).toBeTruthy();
  });

  it('keeps the public profile available when recent results cannot load', async () => {
    publicTeamMocks.getPublicTeamDetail.mockResolvedValue({ id: 'team-1', name: 'Austin Bats', sport: null, description: null, photoUrl: null, city: null, state: null, zip: null, location: null });
    publicTeamMocks.getPublicTeamRecentResults.mockRejectedValue(new Error('projection unavailable'));

    render(<MemoryRouter initialEntries={['/teams/team-1/public']}><Routes><Route path="/teams/:teamId/public" element={<PublicTeamDetail authUser={null} />} /></Routes></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Austin Bats' })).toBeTruthy();
    expect(await screen.findByText('Recent results are temporarily unavailable.')).toBeTruthy();
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
});
