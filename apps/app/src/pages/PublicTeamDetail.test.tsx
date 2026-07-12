// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicTeamDetail } from './PublicTeamDetail';

const publicTeamMocks = vi.hoisted(() => ({ getPublicTeamDetail: vi.fn() }));
vi.mock('../lib/publicTeamsService', () => publicTeamMocks);
vi.mock('lucide-react', () => {
  const Icon = () => null;
  return { Loader2: Icon, MapPin: Icon, ShieldCheck: Icon, Users: Icon };
});

afterEach(() => cleanup());

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
    expect(publicTeamMocks.getPublicTeamDetail).toHaveBeenCalledWith('team-1');
  });
});
