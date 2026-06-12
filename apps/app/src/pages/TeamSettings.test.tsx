// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
    leagueUrl: null,
    bracketUrl: null,
    streamUrl: null,
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
    fireEvent.click(screen.getByRole('button', { name: 'Save team' }));

    await waitFor(() => expect(teamDetailServiceMocks.updateTeamSettingsForApp).toHaveBeenCalledWith('team-1', auth.user, {
      name: 'Lady Bears',
      sport: 'Soccer',
      zip: '66210-1234',
      isPublic: true,
      photoFile: null
    }));
    expect(await screen.findByText('Team detail page')).toBeTruthy();
  });
});
