// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicTeamDetail } from './PublicTeamDetail';

const publicTeamMocks = vi.hoisted(() => ({ getPublicTeamDetail: vi.fn() }));
vi.mock('../lib/publicTeamsService', () => publicTeamMocks);
vi.mock('lucide-react', () => {
  const Icon = () => null;
  return { Loader2: Icon, MapPin: Icon, Shield: Icon, ShieldCheck: Icon, Users: Icon };
});

afterEach(() => cleanup());

describe('PublicTeamDetail', () => {
  beforeEach(() => {
    publicTeamMocks.getPublicTeamDetail.mockReset();
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
});
