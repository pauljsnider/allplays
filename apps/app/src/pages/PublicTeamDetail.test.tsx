// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicTeamDetail } from './PublicTeamDetail';

const publicTeamMocks = vi.hoisted(() => ({ getPublicTeamDetail: vi.fn() }));
vi.mock('../lib/publicTeamsService', () => publicTeamMocks);
vi.mock('lucide-react', () => {
  const Icon = () => null;
  return { Loader2: Icon, MapPin: Icon, Shield: Icon, ShieldCheck: Icon, Users: Icon };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PublicTeamDetail', () => {
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

    render(<MemoryRouter initialEntries={['/teams/team-1/public']}><Routes><Route path="/teams/:teamId/public" element={<PublicTeamDetail />} /></Routes></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Austin Bats' })).toBeTruthy();
    expect(screen.getByText('Public-safe profile')).toBeTruthy();
    expect(screen.getByText('Community baseball team.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Find teams' }).getAttribute('href')).toBe('/teams/browse');
    expect(screen.getByRole('link', { name: 'Enter a join code' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy();
    expect(publicTeamMocks.getPublicTeamDetail).toHaveBeenCalledWith('team-1');
  });

  it('announces loading while the public-safe profile is requested', () => {
    publicTeamMocks.getPublicTeamDetail.mockReturnValue(new Promise(() => {}));

    render(<MemoryRouter initialEntries={['/teams/team-1/public']}><Routes><Route path="/teams/:teamId/public" element={<PublicTeamDetail />} /></Routes></MemoryRouter>);

    expect(screen.getByRole('status')).toHaveTextContent('Loading public team');
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
        <Routes><Route path="/teams/:teamId/public" element={<PublicTeamDetail />} /></Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Austin Bats' })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Next team' }));
    expect(await screen.findByText('Public team not found.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Austin Bats' })).toBeNull();
  });

  it('offers retry and team-search recovery after a load failure', async () => {
    publicTeamMocks.getPublicTeamDetail
      .mockRejectedValueOnce(new Error('Network unavailable.'))
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

    render(<MemoryRouter initialEntries={['/teams/team-1/public']}><Routes><Route path="/teams/:teamId/public" element={<PublicTeamDetail />} /></Routes></MemoryRouter>);

    expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable.');
    expect(screen.getByRole('link', { name: 'Back to team search' }).getAttribute('href')).toBe('/teams/browse');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(publicTeamMocks.getPublicTeamDetail).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('heading', { name: 'Austin Bats' })).toBeTruthy();
  });
});
