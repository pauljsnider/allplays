// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamSettings } from './TeamSettings';
import type { AuthState } from '../lib/types';

const teamDetailServiceMocks = vi.hoisted(() => ({
  loadParentTeamDetail: vi.fn(),
  updateTeamSettingsForApp: vi.fn()
}));

vi.mock('../lib/teamDetailService', () => teamDetailServiceMocks);

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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const managedModel = {
  team: {
    id: 'team-1',
    ownerId: 'owner-1',
    name: 'Bears',
    sport: 'Basketball',
    photoUrl: 'https://img.example.test/team.png',
    description: '',
    zip: '66210',
    isPublic: true,
    active: true,
    leagueUrl: 'https://league.example.test/standings',
    bracketUrl: null,
    streamUrl: 'https://www.youtube.com/watch?v=LJNfHqRRhBI',
    websiteUrl: '',
    editTeamUrl: '',
    mediaUrl: '',
    registrationProvider: [],
    scheduleNotifications: { enabled: true, reminderHours: 24, delivery: 'team_chat', hasExplicitReminderHours: true, summary: '24 hours' }
  },
  players: [],
  inactivePlayers: [],
  linkedPlayers: [],
  upcomingEvents: [],
  recentResults: [],
  nextEvent: null,
  record: { label: '2026', wins: 0, losses: 0, ties: 0, gamesPlayed: 0, winPercentage: null },
  standings: { enabled: false, label: '', rows: [], currentRow: null },
  leaderboards: [],
  trackingSummaries: [],
  sponsors: [],
  statTrackerConfigs: [],
  canManageTeam: true,
  canManageAdmins: false,
  staffPermissions: null,
  counts: { games: 0, practices: 0, completedGames: 0 }
};

describe('TeamSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:preview'),
      writable: true
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(),
      writable: true
    });
    teamDetailServiceMocks.loadParentTeamDetail.mockResolvedValue(managedModel);
    teamDetailServiceMocks.updateTeamSettingsForApp.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it('blocks non-staff users from the direct edit route', async () => {
    teamDetailServiceMocks.loadParentTeamDetail.mockResolvedValue({
      ...managedModel,
      canManageTeam: false
    });

    render(
      <MemoryRouter initialEntries={['/teams/team-1/edit']}>
        <Routes>
          <Route path="/teams/:teamId/edit" element={<TeamSettings auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('Only team staff can edit this team.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save team' })).toBeNull();
  });

  it('shows a retry path when the initial team settings load fails', async () => {
    teamDetailServiceMocks.loadParentTeamDetail
      .mockRejectedValueOnce(new Error('Unable to load team settings.'))
      .mockResolvedValueOnce(managedModel);

    render(
      <MemoryRouter initialEntries={['/teams/team-1/edit']}>
        <Routes>
          <Route path="/teams/:teamId/edit" element={<TeamSettings auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('Team settings unavailable')).toBeTruthy();
    expect(screen.getByText('Unable to load team settings.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('heading', { name: 'Edit team' })).toBeTruthy();
    await waitFor(() => {
      expect(teamDetailServiceMocks.loadParentTeamDetail).toHaveBeenCalledTimes(2);
    });
  });

  it('validates team name inline and saves native team settings', async () => {
    render(
      <MemoryRouter initialEntries={['/teams/team-1/edit']}>
        <Routes>
          <Route path="/teams/:teamId/edit" element={<TeamSettings auth={auth} />} />
          <Route path="/teams/:teamId" element={<div>Team detail page</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Edit team' })).toBeTruthy();
    const nameInput = screen.getByPlaceholderText('Team name');

    fireEvent.change(nameInput, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save team' }));
    expect(await screen.findByText('Team name is required.')).toBeTruthy();
    expect(teamDetailServiceMocks.updateTeamSettingsForApp).not.toHaveBeenCalled();

    fireEvent.change(nameInput, { target: { value: 'Lady Bears' } });
    fireEvent.change(screen.getByPlaceholderText('Basketball'), { target: { value: 'Soccer' } });
    fireEvent.change(screen.getByPlaceholderText('66210'), { target: { value: '66210-1234' } });
    fireEvent.change(screen.getByPlaceholderText('https://league.example.com/standings'), { target: { value: 'https://league.example.test/new' } });
    fireEvent.change(screen.getByPlaceholderText('https://youtu.be/... or https://twitch.tv/...'), { target: { value: 'https://youtu.be/LJNfHqRRhBI' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save team' }));

    await waitFor(() => expect(teamDetailServiceMocks.updateTeamSettingsForApp).toHaveBeenCalledWith('team-1', auth.user, {
      name: 'Lady Bears',
      sport: 'Soccer',
      zip: '66210-1234',
      isPublic: true,
      leagueUrl: 'https://league.example.test/new',
      streamUrl: 'https://youtu.be/LJNfHqRRhBI',
      photoFile: null
    }));
    expect(await screen.findByText('Team detail page')).toBeTruthy();
  });

  it('shows inline validation for invalid livestream links', async () => {
    render(
      <MemoryRouter initialEntries={['/teams/team-1/edit']}>
        <Routes>
          <Route path="/teams/:teamId/edit" element={<TeamSettings auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Edit team' })).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('https://youtu.be/... or https://twitch.tv/...'), { target: { value: 'not a stream url' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save team' }));

    expect(await screen.findByText('Livestream link must be a valid YouTube or Twitch URL.')).toBeTruthy();
    expect(teamDetailServiceMocks.updateTeamSettingsForApp).not.toHaveBeenCalled();
  });

  it('keeps unsaved edits and does not reload when choosing a new photo', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/teams/team-1/edit']}>
        <Routes>
          <Route path="/teams/:teamId/edit" element={<TeamSettings auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Edit team' })).toBeTruthy();
    const nameInput = screen.getByPlaceholderText('Team name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Updated Bears' } });

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['photo'], 'team.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(nameInput.value).toBe('Updated Bears');
    await waitFor(() => {
      expect(teamDetailServiceMocks.loadParentTeamDetail).toHaveBeenCalledTimes(1);
    });
  });

  it('defaults legacy teams without visibility set to public on save', async () => {
    teamDetailServiceMocks.loadParentTeamDetail.mockResolvedValue({
      ...managedModel,
      team: {
        ...managedModel.team,
        isPublic: undefined
      }
    });

    render(
      <MemoryRouter initialEntries={['/teams/team-1/edit']}>
        <Routes>
          <Route path="/teams/:teamId/edit" element={<TeamSettings auth={auth} />} />
          <Route path="/teams/:teamId" element={<div>Team detail page</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Edit team' })).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Team name'), { target: { value: 'Legacy Bears' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save team' }));

    await waitFor(() => expect(teamDetailServiceMocks.updateTeamSettingsForApp).toHaveBeenCalledWith('team-1', auth.user, {
      name: 'Legacy Bears',
      sport: 'Basketball',
      zip: '66210',
      isPublic: true,
      leagueUrl: 'https://league.example.test/standings',
      streamUrl: 'https://www.youtube.com/watch?v=LJNfHqRRhBI',
      photoFile: null
    }));
  });

  it('ignores stale team settings responses after navigating to a different team', async () => {
    const teamOneLoad = createDeferred<typeof managedModel>();
    const teamTwoLoad = createDeferred<typeof managedModel>();

    teamDetailServiceMocks.loadParentTeamDetail.mockImplementation((requestedTeamId: string) => {
      if (requestedTeamId === 'team-1') return teamOneLoad.promise;
      if (requestedTeamId === 'team-2') return teamTwoLoad.promise;
      throw new Error(`Unexpected team id: ${requestedTeamId}`);
    });

    const router = createMemoryRouter(
      [
        {
          path: '/teams/:teamId/edit',
          element: <TeamSettings auth={auth} />
        }
      ],
      { initialEntries: ['/teams/team-1/edit'] }
    );

    render(<RouterProvider router={router} />);

    await act(async () => {
      await router.navigate('/teams/team-2/edit');
    });

    teamTwoLoad.resolve({
      ...managedModel,
      team: {
        ...managedModel.team,
        id: 'team-2',
        name: 'Wolves',
        sport: 'Soccer'
      }
    });

    expect(await screen.findByDisplayValue('Wolves')).toBeTruthy();
    expect((screen.getByPlaceholderText('Basketball') as HTMLInputElement).value).toBe('Soccer');

    teamOneLoad.resolve(managedModel);

    await waitFor(() => {
      expect((screen.getByPlaceholderText('Team name') as HTMLInputElement).value).toBe('Wolves');
      expect((screen.getByPlaceholderText('Basketball') as HTMLInputElement).value).toBe('Soccer');
    });
  });
});
