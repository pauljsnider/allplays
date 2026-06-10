// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamDetail } from './TeamDetail';
import type { AuthState } from '../lib/types';

const teamDetailServiceMocks = vi.hoisted(() => ({
  buildPublicTeamGamesIcsUrl: vi.fn(() => 'https://calendar.example.test/team.ics'),
  canExposePublicFanFeed: vi.fn(() => true),
  createRosterParentInviteForApp: vi.fn(),
  deactivateRosterPlayerForApp: vi.fn(),
  grantScorekeeperAccessForApp: vi.fn(),
  grantVideographerAccessForApp: vi.fn(),
  inviteTeamAdminForApp: vi.fn(),
  loadParentTeamDetail: vi.fn(),
  loadTeamDetailInsights: vi.fn(),
  loadTeamDetailSponsors: vi.fn(),
  loadTeamRosterParentInvites: vi.fn(),
  loadTeamStaffPermissions: vi.fn(),
  reactivateRosterPlayerForApp: vi.fn(),
  revokeScorekeeperAccessForApp: vi.fn(),
  revokeVideographerAccessForApp: vi.fn(),
  saveTeamScheduleNotificationsForApp: vi.fn()
}));

vi.mock('../lib/teamDetailService', () => teamDetailServiceMocks);
vi.mock('../lib/publicActions', () => ({
  copyPublicText: vi.fn(),
  openPublicUrl: vi.fn(),
  sharePublicUrl: vi.fn()
}));
vi.mock('../lib/homeLogic', () => ({
  getEventDetailPath: vi.fn(() => '/schedule/team-1/game-next')
}));
vi.mock('../lib/parentToolsService', () => ({
  buildPrivateTeamCalendarFeedUrl: vi.fn(() => 'https://calendar.example.test/private.ics'),
  getAppleCalendarFeedUrl: vi.fn(() => 'webcal://calendar.example.test/private.ics'),
  getGoogleCalendarFeedUrl: vi.fn(() => 'https://calendar.google.com/calendar/render')
}));
vi.mock('../lib/scheduleService', () => ({
  createStaffRsvpReminderPreviewLoader: vi.fn(() => ({ loadPreview: vi.fn() })),
  sendStaffRsvpReminder: vi.fn()
}));

const auth: AuthState = {
  user: {
    uid: 'parent-1',
    email: 'parent@example.com',
    displayName: 'Pat Parent'
  } as any,
  profile: null,
  loading: false,
  error: null,
  roles: ['parent'],
  isParent: true,
  isCoach: false,
  isAdmin: false,
  isPlatformAdmin: false,
  refresh: vi.fn(),
  signOut: vi.fn()
};

const model = {
  team: {
    id: 'team-1',
    name: 'Bears',
    sport: 'Basketball',
    photoUrl: null,
    description: 'Parent-facing team page',
    zip: '66210',
    isPublic: true,
    active: true,
    leagueUrl: 'https://league.example.test/standings',
    bracketUrl: null,
    streamUrl: null,
    websiteUrl: 'https://allplays.ai/team.html#teamId=team-1',
    editTeamUrl: 'https://allplays.ai/edit-team.html#teamId=team-1',
    mediaUrl: 'https://allplays.ai/team-media.html#teamId=team-1',
    registrationProvider: [],
    scheduleNotifications: {
      enabled: true,
      reminderHours: 24,
      delivery: 'team_chat',
      hasExplicitReminderHours: true,
      summary: '24 hours'
    }
  },
  players: [
    { id: 'player-1', name: 'Pat Star', number: '9', photoUrl: null, position: 'Guard', isLinked: true, active: true }
  ],
  inactivePlayers: [
    { id: 'player-2', name: 'Sam Bench', number: '12', photoUrl: null, position: 'Wing', isLinked: false, active: false }
  ],
  linkedPlayers: [
    { id: 'player-1', name: 'Pat Star', number: '9', photoUrl: null, position: 'Guard', isLinked: true, active: true }
  ],
  upcomingEvents: [],
  recentResults: [],
  nextEvent: null,
  record: { label: '2100', wins: 4, losses: 2, ties: 0, gamesPlayed: 6, winPercentage: 66.7 },
  standings: { enabled: true, label: 'Standings', rows: [], currentRow: null },
  leaderboards: [],
  trackingSummaries: [],
  sponsors: [],
  statTrackerConfigs: [],
  canManageTeam: false,
  staffPermissions: null,
  counts: { games: 0, practices: 0, completedGames: 0 }
};

describe('TeamDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'scrollTo', {
      value: vi.fn(),
      writable: true
    });
    teamDetailServiceMocks.loadParentTeamDetail.mockResolvedValue(model);
    teamDetailServiceMocks.loadTeamDetailInsights.mockResolvedValue({ leaderboards: [], trackingSummaries: [] });
    teamDetailServiceMocks.loadTeamDetailSponsors.mockResolvedValue({ sponsors: [] });
    teamDetailServiceMocks.loadTeamRosterParentInvites.mockResolvedValue([]);
    teamDetailServiceMocks.loadTeamStaffPermissions.mockResolvedValue(null);
    teamDetailServiceMocks.inviteTeamAdminForApp.mockResolvedValue({ status: 'sent', email: 'coach@example.com' });
    teamDetailServiceMocks.createRosterParentInviteForApp.mockResolvedValue({ code: 'ABCD1234', inviteUrl: 'https://allplays.ai/app#/accept-invite?code=ABCD1234&type=parent', status: 'pending', existingUser: false, autoLinked: false, teamName: 'Bears', playerName: 'Pat Star' });
    teamDetailServiceMocks.deactivateRosterPlayerForApp.mockResolvedValue(undefined);
    teamDetailServiceMocks.reactivateRosterPlayerForApp.mockResolvedValue(undefined);
    teamDetailServiceMocks.grantScorekeeperAccessForApp.mockResolvedValue({ success: true });
    teamDetailServiceMocks.revokeScorekeeperAccessForApp.mockResolvedValue({ success: true });
    teamDetailServiceMocks.grantVideographerAccessForApp.mockResolvedValue({ success: true });
    teamDetailServiceMocks.revokeVideographerAccessForApp.mockResolvedValue({ success: true });
    teamDetailServiceMocks.saveTeamScheduleNotificationsForApp.mockResolvedValue(model.team.scheduleNotifications);
  });

  afterEach(() => {
    cleanup();
  });

  it('does not reload team detail when the auth object identity changes but the signed-in user does not', async () => {
    const initialAuth: AuthState = { ...auth, user: { ...auth.user! } as AuthState['user'] };
    const nextAuth: AuthState = { ...auth, user: { ...auth.user! } as AuthState['user'] };
    const view = render(
      <MemoryRouter initialEntries={['/teams/team-1']}>
        <Routes>
          <Route path="/teams/:teamId" element={<TeamDetail auth={initialAuth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Bears' })).toBeTruthy();
    expect(teamDetailServiceMocks.loadParentTeamDetail).toHaveBeenCalledTimes(1);

    view.rerender(
      <MemoryRouter initialEntries={['/teams/team-1']}>
        <Routes>
          <Route path="/teams/:teamId" element={<TeamDetail auth={nextAuth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Bears' })).toBeTruthy();
    expect(teamDetailServiceMocks.loadParentTeamDetail).toHaveBeenCalledTimes(1);
  });

  it('lets team staff deactivate and reactivate players from the roster tab', async () => {
    const managedModel = {
      ...model,
      canManageTeam: true
    };
    teamDetailServiceMocks.loadParentTeamDetail
      .mockResolvedValueOnce(managedModel)
      .mockResolvedValueOnce({
        ...managedModel,
        players: [],
        inactivePlayers: [
          managedModel.inactivePlayers[0],
          { ...managedModel.players[0], active: false }
        ]
      })
      .mockResolvedValueOnce(managedModel);
    vi.spyOn(window, 'confirm')
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true);

    render(
      <MemoryRouter initialEntries={['/teams/team-1']}>
        <Routes>
          <Route path="/teams/:teamId" element={<TeamDetail auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Bears' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /roster/i }));

    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));

    await waitFor(() => expect(teamDetailServiceMocks.deactivateRosterPlayerForApp).toHaveBeenCalledWith('team-1', 'player-1'));
    expect(await screen.findByText('Pat Star deactivated.')).toBeTruthy();
    expect(await screen.findByText('Inactive roster')).toBeTruthy();

    const reactivateButtons = await screen.findAllByRole('button', { name: 'Reactivate' });
    fireEvent.click(reactivateButtons[0]);

    await waitFor(() => expect(teamDetailServiceMocks.reactivateRosterPlayerForApp).toHaveBeenCalledWith('team-1', 'player-2'));
    expect(await screen.findByText('Sam Bench reactivated.')).toBeTruthy();
  });

  it('loads roster invite summaries only once per roster visit when the result is empty', async () => {
    const managedModel = {
      ...model,
      canManageTeam: true
    };
    teamDetailServiceMocks.loadParentTeamDetail.mockResolvedValue(managedModel);
    teamDetailServiceMocks.loadTeamRosterParentInvites.mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={['/teams/team-1']}>
        <Routes>
          <Route path="/teams/:teamId" element={<TeamDetail auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Bears' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /roster/i }));

    await waitFor(() => expect(teamDetailServiceMocks.loadTeamRosterParentInvites).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: 'Invite parent' })).toBeTruthy();
    await waitFor(() => expect(teamDetailServiceMocks.loadTeamRosterParentInvites).toHaveBeenCalledTimes(1));
  });

  it('passes the signed-in user to parent invite creation and refreshes summaries after success', async () => {
    const managedModel = {
      ...model,
      canManageTeam: true
    };
    teamDetailServiceMocks.loadParentTeamDetail.mockResolvedValue(managedModel);
    teamDetailServiceMocks.loadTeamRosterParentInvites
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ playerId: 'player-1', status: 'pending', acceptedParentCount: 0, pendingInviteCount: 1, latestPendingCode: 'ABCD1234' }]);

    render(
      <MemoryRouter initialEntries={['/teams/team-1']}>
        <Routes>
          <Route path="/teams/:teamId" element={<TeamDetail auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Bears' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /roster/i }));
    expect(await screen.findByRole('button', { name: 'Invite parent' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Invite parent' }));

    await waitFor(() => expect(teamDetailServiceMocks.createRosterParentInviteForApp).toHaveBeenCalledWith('team-1', auth.user, expect.objectContaining({ id: 'player-1', number: '9' })));
    await waitFor(() => expect(teamDetailServiceMocks.loadTeamRosterParentInvites).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Parent invite is ready to copy or share.')).toBeTruthy();
  });
});
