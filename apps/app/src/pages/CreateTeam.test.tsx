// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateTeam } from './CreateTeam';
import type { AuthState } from '../lib/types';

const teamCreationMocks = vi.hoisted(() => ({
  createTeamForApp: vi.fn(),
  getCreateTeamSportOptions: vi.fn(() => ['Basketball', 'Soccer', 'Baseball'])
}));

vi.mock('../lib/teamCreationService', () => teamCreationMocks);
vi.mock('lucide-react', () => {
  const Icon = () => null;
  return {
    ArrowLeft: Icon,
    CheckCircle2: Icon,
    Loader2: Icon,
    Save: Icon,
    Shield: Icon,
    Users: Icon
  };
});

const auth: AuthState = {
  user: {
    uid: 'coach-1',
    email: 'coach@example.com',
    displayName: 'Coach'
  } as any,
  profile: null,
  loading: false,
  error: null,
  roles: ['coach'],
  isParent: false,
  isCoach: true,
  isAdmin: false,
  isPlatformAdmin: false,
  refresh: vi.fn(),
  signOut: vi.fn()
};

function TeamDetailRoute() {
  const { teamId } = useParams<{ teamId: string }>();
  return <div>Team detail: {teamId}</div>;
}

function renderCreateTeam(authOverride = auth) {
  return render(
    <MemoryRouter initialEntries={['/teams/new']}>
      <Routes>
        <Route path="/teams/new" element={<CreateTeam auth={authOverride} />} />
        <Route path="/teams/:teamId" element={<TeamDetailRoute />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('CreateTeam', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    teamCreationMocks.createTeamForApp.mockResolvedValue({
      teamId: 'team-new',
      defaultStatConfigCreated: true,
      defaultStatConfigError: null
    });
    teamCreationMocks.getCreateTeamSportOptions.mockReturnValue(['Basketball', 'Soccer', 'Baseball']);
  });

  afterEach(() => {
    cleanup();
  });

  it('validates required fields and creates a team from the app form', async () => {
    renderCreateTeam();

    fireEvent.click(screen.getByRole('button', { name: 'Create team' }));
    expect(await screen.findByText('Team name is required.')).toBeTruthy();
    expect(teamCreationMocks.createTeamForApp).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('Team name'), { target: { value: 'KC Current U12' } });
    fireEvent.change(screen.getByLabelText('Sport'), { target: { value: 'Soccer' } });
    fireEvent.change(screen.getByPlaceholderText('66210'), { target: { value: '66210-1234' } });
    fireEvent.click(screen.getByLabelText('Public team'));
    fireEvent.click(screen.getByRole('button', { name: 'Create team' }));

    await waitFor(() => expect(teamCreationMocks.createTeamForApp).toHaveBeenCalledWith(auth.user, {
      name: 'KC Current U12',
      sport: 'Soccer',
      zip: '66210-1234',
      isPublic: false
    }));
    expect(await screen.findByText('Team detail: team-new')).toBeTruthy();
  });

  it('keeps the created team reachable when default stat config creation returns a warning', async () => {
    teamCreationMocks.createTeamForApp.mockResolvedValueOnce({
      teamId: 'team-new',
      defaultStatConfigCreated: false,
      defaultStatConfigError: 'permission denied'
    });
    renderCreateTeam();

    fireEvent.change(screen.getByPlaceholderText('Team name'), { target: { value: 'Warn Team' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create team' }));

    expect(await screen.findByText(/Team created, but the default stat config could not be added/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open team' })).toHaveAttribute('href', '/teams/team-new');
    const openTeamButton = await screen.findByRole('button', { name: 'Open team' });
    expect(openTeamButton).not.toBeDisabled();

    fireEvent.click(openTeamButton);

    expect(teamCreationMocks.createTeamForApp).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Team detail: team-new')).toBeTruthy();
  });

  it('blocks direct rendering without a signed-in user', () => {
    renderCreateTeam({ ...auth, user: null, roles: [] });

    expect(screen.getByText('Sign in to create a team')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create team' })).toBeNull();
  });
});
