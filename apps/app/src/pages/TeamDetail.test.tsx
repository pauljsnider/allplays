// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamDetail } from './TeamDetail';
import type { AuthState } from '../lib/types';

const teamDetailServiceMocks = vi.hoisted(() => ({
  addRosterPlayerForApp: vi.fn(),
  archiveTeamTrackingItemForApp: vi.fn(),
  buildPublicTeamGamesIcsUrl: vi.fn(() => 'https://calendar.example.test/team.ics'),
  canExposePublicFanFeed: vi.fn(() => true),
  createStatTrackerConfigForApp: vi.fn(),
  createRosterParentInviteForApp: vi.fn(),
  deactivateRosterPlayerForApp: vi.fn(),
  grantScorekeeperAccessForApp: vi.fn(),
  grantVideographerAccessForApp: vi.fn(),
  inviteTeamAdminForApp: vi.fn(),
  loadParentTeamDetail: vi.fn(),
  loadParentTeamDetailBootstrap: vi.fn(),
  loadRosterFieldDefinitionsForApp: vi.fn(),
  loadTeamDetailInsights: vi.fn(),
  loadTeamDetailSponsors: vi.fn(),
  loadTeamRosterParentInvites: vi.fn(),
  loadTeamStaffPermissions: vi.fn(),
  loadTeamTrackingAdmin: vi.fn(),
  reactivateRosterPlayerForApp: vi.fn(),
  revokeScorekeeperAccessForApp: vi.fn(),
  revokeTeamAdminAccessForApp: vi.fn(),
  revokeVideographerAccessForApp: vi.fn(),
  saveTeamScheduleNotificationsForApp: vi.fn(),
  saveTeamTrackingItemForApp: vi.fn(),
  setPlayerTrackingStatusForApp: vi.fn(),
  updateStatTrackerConfigForApp: vi.fn()
}));

const scheduleServiceMocks = vi.hoisted(() => ({
  loadPreview: vi.fn(),
  createStaffRsvpReminderPreviewLoader: vi.fn(),
  sendStaffRsvpReminder: vi.fn()
}));

const rosterAiImportMocks = vi.hoisted(() => ({
  buildRosterAiImportCommitPlan: vi.fn((rows: any[] = []) => ({
    addPlayers: rows.filter((row) => !row.errors?.length).map((row) => ({ name: row.name, number: row.number })),
    skippedRows: rows.filter((row) => row.errors?.length)
  })),
  generateRosterAiImportRows: vi.fn(),
  removeRosterAiImportPreviewRow: vi.fn((rows: any[] = [], rowNumber: number) => rows.filter((row) => row.rowNumber !== rowNumber)),
  updateRosterAiImportPreviewRow: vi.fn((rows: any[] = [], rowNumber: number, changes: any) => rows.map((row) => row.rowNumber === rowNumber ? { ...row, ...changes, errors: [], duplicatePlayerId: '', duplicatePlayerName: '' } : row))
}));

vi.mock('../lib/teamDetailService', () => teamDetailServiceMocks);
vi.mock('../lib/rosterAiImport', () => rosterAiImportMocks);
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
vi.mock('../lib/scheduleService', () => scheduleServiceMocks);
vi.mock('lucide-react', () => {
  const Icon = () => null;
  return {
    Award: Icon,
    BarChart3: Icon,
    CalendarDays: Icon,
    CheckCircle2: Icon,
    ChevronRight: Icon,
    Code2: Icon,
    Copy: Icon,
    DollarSign: Icon,
    Dumbbell: Icon,
    ExternalLink: Icon,
    ImageIcon: Icon,
    LinkIcon: Icon,
    Loader2: Icon,
    MapPin: Icon,
    MessageCircle: Icon,
    Radio: Icon,
    RefreshCw: Icon,
    Save: Icon,
    Shield: Icon,
    Ticket: Icon,
    Trophy: Icon,
    UserPlus: Icon,
    UserRound: Icon,
    Users: Icon,
    Zap: Icon
  };
});

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
    ownerId: 'owner-1',
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
  canManageAdmins: false,
  staffPermissions: null,
  counts: { games: 0, practices: 0, completedGames: 0 }
};

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('TeamDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'scrollTo', {
      value: vi.fn(),
      writable: true
    });
    teamDetailServiceMocks.loadParentTeamDetail.mockResolvedValue(model);
    teamDetailServiceMocks.loadParentTeamDetailBootstrap.mockImplementation((...args: any[]) => teamDetailServiceMocks.loadParentTeamDetail(...args));
    teamDetailServiceMocks.loadRosterFieldDefinitionsForApp.mockResolvedValue([]);
    teamDetailServiceMocks.loadTeamDetailInsights.mockResolvedValue({ leaderboards: [], trackingSummaries: [] });
    teamDetailServiceMocks.loadTeamDetailSponsors.mockResolvedValue({ sponsors: [] });
    teamDetailServiceMocks.loadTeamRosterParentInvites.mockResolvedValue([]);
    teamDetailServiceMocks.loadTeamStaffPermissions.mockResolvedValue(null);
    teamDetailServiceMocks.loadTeamTrackingAdmin.mockResolvedValue([]);
    teamDetailServiceMocks.inviteTeamAdminForApp.mockResolvedValue({ status: 'sent', email: 'coach@example.com' });
    teamDetailServiceMocks.addRosterPlayerForApp.mockResolvedValue({ playerId: 'player-2' });
    teamDetailServiceMocks.archiveTeamTrackingItemForApp.mockResolvedValue(undefined);
    teamDetailServiceMocks.createStatTrackerConfigForApp.mockResolvedValue('config-new');
    teamDetailServiceMocks.createRosterParentInviteForApp.mockResolvedValue({ code: 'ABCD1234', inviteUrl: 'https://allplays.ai/app#/accept-invite?code=ABCD1234&type=parent', status: 'pending', existingUser: false, autoLinked: false, teamName: 'Bears', playerName: 'Pat Star' });
    teamDetailServiceMocks.deactivateRosterPlayerForApp.mockResolvedValue(undefined);
    teamDetailServiceMocks.reactivateRosterPlayerForApp.mockResolvedValue(undefined);
    teamDetailServiceMocks.grantScorekeeperAccessForApp.mockResolvedValue({ success: true });
    teamDetailServiceMocks.revokeScorekeeperAccessForApp.mockResolvedValue({ success: true });
    teamDetailServiceMocks.revokeTeamAdminAccessForApp.mockResolvedValue({ success: true });
    teamDetailServiceMocks.grantVideographerAccessForApp.mockResolvedValue({ success: true });
    teamDetailServiceMocks.revokeVideographerAccessForApp.mockResolvedValue({ success: true });
    teamDetailServiceMocks.saveTeamScheduleNotificationsForApp.mockResolvedValue(model.team.scheduleNotifications);
    teamDetailServiceMocks.saveTeamTrackingItemForApp.mockResolvedValue('item-new');
    teamDetailServiceMocks.setPlayerTrackingStatusForApp.mockResolvedValue(undefined);
    teamDetailServiceMocks.updateStatTrackerConfigForApp.mockResolvedValue(undefined);
    scheduleServiceMocks.loadPreview.mockReset();
    scheduleServiceMocks.createStaffRsvpReminderPreviewLoader.mockReset();
    scheduleServiceMocks.sendStaffRsvpReminder.mockReset();
    scheduleServiceMocks.createStaffRsvpReminderPreviewLoader.mockReturnValue({ loadPreview: scheduleServiceMocks.loadPreview });
    scheduleServiceMocks.loadPreview.mockResolvedValue({
      missingPlayerCount: 0,
      eligibleEmailCount: 0,
      emailRecipientCount: 0,
      chatRecipientCount: 0,
      skippedPlayers: []
    });
    scheduleServiceMocks.sendStaffRsvpReminder.mockResolvedValue({
      missingPlayerCount: 0,
      eligibleEmailCount: 0,
      emailSentCount: 0,
      chatMessageSent: true
    });
    rosterAiImportMocks.generateRosterAiImportRows.mockResolvedValue({ rows: [], errors: [] });
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the shared team skeleton while team detail is loading', () => {
    teamDetailServiceMocks.loadParentTeamDetailBootstrap.mockReturnValue(new Promise(() => {}));

    render(
      <MemoryRouter initialEntries={['/teams/team-1']}>
        <Routes>
          <Route path="/teams/:teamId" element={<TeamDetail auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByRole('status', { name: 'Loading team' })).toBeTruthy();
    expect(screen.queryByText('Getting the team photo, roster, schedule, standings, and parent-visible insights.')).toBeNull();
  });

  it('shows a retryable team detail error state and reloads on retry', async () => {
    teamDetailServiceMocks.loadParentTeamDetailBootstrap
      .mockRejectedValueOnce(new Error('Team detail unavailable.'))
      .mockResolvedValueOnce(model);

    render(
      <MemoryRouter initialEntries={['/teams/team-1']}>
        <Routes>
          <Route path="/teams/:teamId" element={<TeamDetail auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('Team detail unavailable.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('heading', { name: 'Bears' })).toBeTruthy();
    expect(teamDetailServiceMocks.loadParentTeamDetailBootstrap).toHaveBeenCalledTimes(2);
  });

  it('uses the lightweight bootstrap on overview and defers full detail until schedule opens', async () => {
    teamDetailServiceMocks.loadParentTeamDetailBootstrap.mockResolvedValue({
      ...model,
      upcomingEvents: [],
      recentResults: [],
      statTrackerConfigs: []
    });
    teamDetailServiceMocks.loadParentTeamDetail.mockResolvedValue({
      ...model,
      upcomingEvents: [{
        id: 'game-next',
        title: 'Bears vs Tigers',
        type: 'game',
        date: new Date(Date.now() + 24 * 60 * 60 * 1000),
        location: 'Main Gym',
        opponent: 'Tigers',
        status: 'scheduled',
        liveStatus: '',
        visibility: 'public',
        isPrivate: false,
        isPublic: true,
        shareable: true,
        publicCalendar: true,
        homeScore: null,
        awayScore: null,
        isCancelled: false,
        statTrackerConfigId: '',
        statTrackerConfigLabel: 'No config assigned',
        statTrackerConfigBaseType: '',
        statTrackerConfigExists: false,
        statTrackerConfigIsBasketball: false
      }]
    });

    render(
      <MemoryRouter initialEntries={['/teams/team-1']}>
        <Routes>
          <Route path="/teams/:teamId" element={<TeamDetail auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Bears' })).toBeTruthy();
    expect(teamDetailServiceMocks.loadParentTeamDetailBootstrap).toHaveBeenCalledTimes(1);
    expect(teamDetailServiceMocks.loadParentTeamDetail).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /schedule/i }));

    await waitFor(() => expect(teamDetailServiceMocks.loadParentTeamDetail).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Bears vs Tigers')).toBeTruthy();
  });

  it('retries a retryable RSVP reminder preview failure from the shared error state', async () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const managedModel = {
      ...model,
      canManageTeam: true,
      upcomingEvents: [{
        id: 'game-next',
        title: 'Bears vs Tigers',
        type: 'game',
        date: futureDate,
        location: 'Main Gym',
        opponent: 'Tigers',
        status: 'scheduled',
        isCancelled: false,
        homeScore: null,
        awayScore: null,
        statTrackerConfigId: '',
        statTrackerConfigExists: false,
        statTrackerConfigLabel: 'No stat config',
        statTrackerConfigIsBasketball: false
      }]
    };
    teamDetailServiceMocks.loadParentTeamDetail.mockResolvedValue(managedModel);
    scheduleServiceMocks.loadPreview
      .mockRejectedValueOnce(new Error('Reminder preview temporarily unavailable.'))
      .mockResolvedValueOnce({
        missingPlayerCount: 0,
        eligibleEmailCount: 0,
        emailRecipientCount: 0,
        chatRecipientCount: 0,
        skippedPlayers: []
      });

    render(
      <MemoryRouter initialEntries={['/teams/team-1?tab=schedule']}>
        <Routes>
          <Route path="/teams/:teamId" element={<TeamDetail auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('Bears vs Tigers')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review reminder' }));

    expect(await screen.findByText('Reminder preview temporarily unavailable.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry reminder preview' }));

    expect(await screen.findByText('All player RSVPs are in.')).toBeTruthy();
    expect(scheduleServiceMocks.loadPreview).toHaveBeenCalledTimes(2);
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

  it('drives team tabs from the route search state', async () => {
    const router = createMemoryRouter(
      [
        {
          path: '/teams/:teamId',
          element: <TeamDetail auth={auth} />
        }
      ],
      { initialEntries: ['/teams/team-1?tab=roster'] }
    );

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: 'Bears' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /roster/i }).getAttribute('aria-pressed')).toBe('true');
    expect(router.state.location.search).toBe('?tab=roster');

    fireEvent.click(screen.getByRole('button', { name: /more/i }));
    await waitFor(() => expect(router.state.location.search).toBe('?tab=more'));
    expect(screen.getByRole('button', { name: /more/i }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: /overview/i }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(screen.getByRole('button', { name: /overview/i }).getAttribute('aria-pressed')).toBe('true');
  });

  it('steps back to team overview before leaving the team hub', async () => {
    const router = createMemoryRouter(
      [
        {
          path: '/teams',
          element: <div>Teams list</div>
        },
        {
          path: '/teams/:teamId',
          element: <TeamDetail auth={auth} />
        }
      ],
      { initialEntries: ['/teams', '/teams/team-1', '/teams/team-1?tab=roster'], initialIndex: 2 }
    );

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: 'Bears' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /roster/i }).getAttribute('aria-pressed')).toBe('true');

    await act(async () => {
      await router.navigate(-1);
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/teams/team-1'));
    expect(router.state.location.search).toBe('');
    expect(screen.getByRole('button', { name: /overview/i }).getAttribute('aria-pressed')).toBe('true');

    await act(async () => {
      await router.navigate(-1);
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/teams'));
    expect(await screen.findByText('Teams list')).toBeTruthy();
  });

  it('renders native standings rows with the current team highlight and expandable overflow', async () => {
    const standingsRows = [
      { rank: 1, team: 'Lions', w: 8, l: 1, t: 0, points: 16 },
      { rank: 2, team: 'Tigers', w: 7, l: 2, t: 0, points: 14 },
      { rank: 3, team: 'Wolves', w: 6, l: 3, t: 0, points: 12 },
      { rank: 4, team: 'Hawks', w: 5, l: 4, t: 0, points: 10 },
      { rank: 5, team: 'Falcons', w: 4, l: 5, t: 0, points: 8 },
      { rank: 6, team: 'Bears', w: 3, l: 6, t: 0, points: 6 }
    ];
    teamDetailServiceMocks.loadParentTeamDetail.mockResolvedValue({
      ...model,
      standings: {
        enabled: true,
        label: 'Points table',
        rows: standingsRows,
        currentRow: standingsRows[5]
      }
    });

    render(
      <MemoryRouter initialEntries={['/teams/team-1']}>
        <Routes>
          <Route path="/teams/:teamId" element={<TeamDetail auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Bears' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Rank' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Record' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'PTS' })).toBeTruthy();
    expect(screen.getByText('Lions')).toBeTruthy();
    expect(screen.queryByText('Falcons')).toBeNull();
    const currentTeamCell = screen.getAllByText('Bears').find((element) => element.tagName === 'TD');
    expect(currentTeamCell).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show 1 more team' })).toBeTruthy();

    const currentTeamRow = currentTeamCell?.closest('tr');
    expect(currentTeamRow?.getAttribute('aria-current')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Show 1 more team' }));
    expect(await screen.findByText('Falcons')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show fewer teams' })).toBeTruthy();
  });

  it('shows win percentage as the standings context column when the standings label is win percentage', async () => {
    const standingsRows = [
      { rank: 1, team: 'Lions', w: 8, l: 1, t: 0, points: 16, winPct: 0.889 },
      { rank: 2, team: 'Bears', w: 6, l: 3, t: 0, points: 12, winPct: 0.667 }
    ];
    teamDetailServiceMocks.loadParentTeamDetail.mockResolvedValue({
      ...model,
      standings: {
        enabled: true,
        label: 'Win percentage',
        rows: standingsRows,
        currentRow: standingsRows[1]
      }
    });

    render(
      <MemoryRouter initialEntries={['/teams/team-1']}>
        <Routes>
          <Route path="/teams/:teamId" element={<TeamDetail auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Bears' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'PCT' })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'PTS' })).toBeNull();
    expect(screen.getByText('0.667')).toBeTruthy();
  });

  it('falls back to the external league page when native standings rows are unavailable', async () => {
    render(
      <MemoryRouter initialEntries={['/teams/team-1']}>
        <Routes>
          <Route path="/teams/:teamId" element={<TeamDetail auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Bears' })).toBeTruthy();
    const leagueLinks = screen.getAllByRole('link', { name: 'League page' });
    expect(leagueLinks.some((link) => link.getAttribute('href') === 'https://league.example.test/standings')).toBe(true);
    expect(screen.getByText('Open the league page for current standings.')).toBeTruthy();
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
    const confirmSpy = vi.spyOn(window, 'confirm')
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

    expect(confirmSpy).toHaveBeenCalledWith('Deactivate Pat Star?\n\nLinked parents may lose access to this team, including history, until the player is reactivated or parent scope is repaired.');
    await waitFor(() => expect(teamDetailServiceMocks.deactivateRosterPlayerForApp).toHaveBeenCalledWith('team-1', 'player-1'));
    expect(await screen.findByText('Pat Star deactivated.')).toBeTruthy();
    expect(await screen.findByText('Inactive roster')).toBeTruthy();

    const reactivateButtons = await screen.findAllByRole('button', { name: 'Reactivate' });
    fireEvent.click(reactivateButtons[0]);

    expect(confirmSpy).toHaveBeenCalledWith('Reactivate Sam Bench?');
    await waitFor(() => expect(teamDetailServiceMocks.reactivateRosterPlayerForApp).toHaveBeenCalledWith('team-1', 'player-2'));
    expect(await screen.findByText('Sam Bench reactivated.')).toBeTruthy();
  });

  it('shows the native add-player form only for team managers', async () => {
    render(
      <MemoryRouter initialEntries={['/teams/team-1']}>
        <Routes>
          <Route path="/teams/:teamId" element={<TeamDetail auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Bears' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /roster/i }));
    expect(screen.queryByRole('button', { name: 'Add player' })).toBeNull();

    cleanup();
    teamDetailServiceMocks.loadParentTeamDetail.mockResolvedValue({
      ...model,
      canManageTeam: true
    });

    render(
      <MemoryRouter initialEntries={['/teams/team-1']}>
        <Routes>
          <Route path="/teams/:teamId" element={<TeamDetail auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Bears' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /roster/i }));
    expect(await screen.findByRole('button', { name: 'Add player' })).toBeTruthy();
  });

  it('lets team staff add a player from the native roster tab and refreshes the roster', async () => {
    const managedModel = {
      ...model,
      canManageTeam: true
    };
    teamDetailServiceMocks.loadParentTeamDetail
      .mockResolvedValueOnce(managedModel)
      .mockResolvedValueOnce({
        ...managedModel,
        players: [
          ...managedModel.players,
          { id: 'player-2', name: 'Alex New', number: '14', photoUrl: null, position: '', isLinked: false, active: true }
        ]
      });
    teamDetailServiceMocks.loadRosterFieldDefinitionsForApp.mockResolvedValue([
      {
        key: 'grad_year',
        label: 'Grad Year',
        type: 'menu',
        section: '',
        required: false,
        options: [{ value: '2028', label: '2028' }],
        description: '',
        visibility: 'team',
        active: true,
        sortOrder: 1
      }
    ]);

    render(
      <MemoryRouter initialEntries={['/teams/team-1']}>
        <Routes>
          <Route path="/teams/:teamId" element={<TeamDetail auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Bears' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /roster/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add player' }));

    await waitFor(() => expect(teamDetailServiceMocks.loadRosterFieldDefinitionsForApp).toHaveBeenCalledWith('team-1', auth.user));
    fireEvent.change(screen.getByPlaceholderText('Player name'), { target: { value: 'Alex New' } });
    fireEvent.change(screen.getByPlaceholderText('Optional'), { target: { value: '14' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Grad Year' }), { target: { value: '2028' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save player' }));

    await waitFor(() => expect(teamDetailServiceMocks.addRosterPlayerForApp).toHaveBeenCalledWith('team-1', auth.user, {
      name: 'Alex New',
      number: '14',
      photoFile: null,
      rosterFieldValues: {
        grad_year: '2028'
      }
    }));
    await waitFor(() => expect(teamDetailServiceMocks.loadParentTeamDetail).toHaveBeenCalledTimes(2));
    const status = await screen.findByText('Alex New added to roster.');
    expect(status.closest('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
  });

  it('lazy-loads roster AI import, previews editable rows, and writes through the manual add service', async () => {
    const managedModel = {
      ...model,
      canManageTeam: true
    };
    teamDetailServiceMocks.loadParentTeamDetail
      .mockResolvedValueOnce(managedModel)
      .mockResolvedValueOnce({
        ...managedModel,
        players: [
          ...managedModel.players,
          { id: 'player-3', name: 'Alex New', number: '14', photoUrl: null, position: '', isLinked: false, active: true }
        ]
      });
    rosterAiImportMocks.generateRosterAiImportRows.mockResolvedValue({
      errors: [],
      rows: [
        {
          rowNumber: 1,
          action: 'add',
          name: 'Pat Star',
          number: '9',
          reason: 'read from photo row 1',
          duplicatePlayerId: 'player-1',
          duplicatePlayerName: 'Pat Star',
          errors: ['Possible duplicate of existing roster player Pat Star #9.']
        },
        {
          rowNumber: 2,
          action: 'add',
          name: 'Alex New',
          number: '14',
          reason: 'read from photo row 2',
          duplicatePlayerId: '',
          duplicatePlayerName: '',
          errors: []
        }
      ]
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <MemoryRouter initialEntries={['/teams/team-1?tab=roster']}>
        <Routes>
          <Route path="/teams/:teamId" element={<TeamDetail auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Bears' })).toBeTruthy();
    expect(rosterAiImportMocks.generateRosterAiImportRows).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'Import roster' }));
    fireEvent.change(screen.getByLabelText('Roster text or AI instructions'), { target: { value: '#14 Alex New' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate preview' }));

    await waitFor(() => expect(rosterAiImportMocks.generateRosterAiImportRows).toHaveBeenCalledWith({
      text: '#14 Alex New',
      imageFile: null,
      currentPlayers: [managedModel.players[0], managedModel.inactivePlayers[0]]
    }));
    expect(await screen.findByText('Possible duplicate of existing roster player Pat Star #9.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Import reviewed players' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
    expect(await screen.findByDisplayValue('Alex New')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Import reviewed players' }));

    expect(confirmSpy).toHaveBeenCalledWith('Import 1 reviewed player row to Bears?');
    await waitFor(() => expect(teamDetailServiceMocks.addRosterPlayerForApp).toHaveBeenCalledWith('team-1', auth.user, {
      name: 'Alex New',
      number: '14',
      rosterFieldValues: {}
    }));
    await waitFor(() => expect(teamDetailServiceMocks.loadParentTeamDetail).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Imported 1 player: #14 Alex New.')).toBeTruthy();
  });

  it('uses descriptive alt text for team and roster photos', async () => {
    teamDetailServiceMocks.loadParentTeamDetail.mockResolvedValue({
      ...model,
      team: {
        ...model.team,
        photoUrl: 'https://cdn.example.test/team.jpg'
      },
      players: [
        { ...model.players[0], photoUrl: 'https://cdn.example.test/player.jpg' }
      ]
    });

    render(
      <MemoryRouter initialEntries={['/teams/team-1']}>
        <Routes>
          <Route path="/teams/:teamId" element={<TeamDetail auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByAltText('Bears team photo')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /roster/i }));
    expect(await screen.findByAltText('Pat Star player photo')).toBeTruthy();
  });

  it('clears roster invite and tracking loading states after deferred roster loads finish', async () => {
    const managedModel = {
      ...model,
      canManageTeam: true
    };
    const inviteLoad = createDeferred<unknown[]>();
    const trackingLoad = createDeferred<unknown[]>();
    teamDetailServiceMocks.loadParentTeamDetail.mockResolvedValue(managedModel);
    teamDetailServiceMocks.loadTeamRosterParentInvites.mockReturnValue(inviteLoad.promise);
    teamDetailServiceMocks.loadTeamTrackingAdmin.mockReturnValue(trackingLoad.promise);

    render(
      <MemoryRouter initialEntries={['/teams/team-1?tab=roster']}>
        <Routes>
          <Route path="/teams/:teamId" element={<TeamDetail auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('Loading parent invite status…')).toBeTruthy();
    expect(await screen.findByText('Loading tracking items…')).toBeTruthy();

    inviteLoad.resolve([]);
    trackingLoad.resolve([]);

    await waitFor(() => {
      expect(screen.queryByText('Loading parent invite status…')).toBeNull();
      expect(screen.queryByText('Loading tracking items…')).toBeNull();
    });
    expect(screen.getByText('No tracking items found.')).toBeTruthy();
  });

  it('renders multiple tracking items with completion badges and lets staff manage statuses from the roster tab', async () => {
    const managedModel = {
      ...model,
      canManageTeam: true
    };
    teamDetailServiceMocks.loadParentTeamDetail.mockResolvedValue(managedModel);
    teamDetailServiceMocks.loadTeamTrackingAdmin
      .mockResolvedValueOnce([
        {
          id: 'item-1',
          name: 'Waiver',
          description: 'Signed form',
          visibility: 'public',
          status: 'active',
          active: true,
          archived: false,
          completionSummary: { total: 1, complete: 0, incomplete: 1 },
          playerStatuses: [{ playerId: 'player-1', playerName: 'Pat Star', playerNumber: '9', photoUrl: null, complete: false }]
        },
        {
          id: 'item-2',
          name: 'Jersey',
          description: '',
          visibility: 'private',
          status: 'active',
          active: true,
          archived: false,
          completionSummary: { total: 1, complete: 1, incomplete: 0 },
          playerStatuses: [{ playerId: 'player-1', playerName: 'Pat Star', playerNumber: '9', photoUrl: null, complete: true }]
        }
      ])
      .mockResolvedValueOnce([
        {
          id: 'item-1',
          name: 'Waiver',
          description: 'Signed form',
          visibility: 'public',
          status: 'active',
          active: true,
          archived: false,
          completionSummary: { total: 1, complete: 1, incomplete: 0 },
          playerStatuses: [{ playerId: 'player-1', playerName: 'Pat Star', playerNumber: '9', photoUrl: null, complete: true }]
        }
      ])
      .mockResolvedValueOnce([
        {
          id: 'item-1',
          name: 'Waiver',
          description: 'Signed form',
          visibility: 'public',
          status: 'active',
          active: true,
          archived: false,
          completionSummary: { total: 1, complete: 1, incomplete: 0 },
          playerStatuses: [{ playerId: 'player-1', playerName: 'Pat Star', playerNumber: '9', photoUrl: null, complete: true }]
        }
      ])
      .mockResolvedValueOnce([]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <MemoryRouter initialEntries={['/teams/team-1?tab=roster']}>
        <Routes>
          <Route path="/teams/:teamId" element={<TeamDetail auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Bears' })).toBeTruthy();
    expect(await screen.findByText('Tracking items')).toBeTruthy();
    expect(await screen.findByText('Waiver')).toBeTruthy();
    expect(await screen.findByText('Jersey')).toBeTruthy();
    expect(screen.getByText('0/1 done')).toBeTruthy();
    expect(screen.getByText('1/1 done')).toBeTruthy();
    await waitFor(() => expect(teamDetailServiceMocks.loadTeamTrackingAdmin).toHaveBeenCalledWith('team-1', auth.user));

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(teamDetailServiceMocks.setPlayerTrackingStatusForApp).toHaveBeenCalledWith('team-1', auth.user, 'item-1', expect.objectContaining({ id: 'player-1', number: '9' }), true));
    expect(await screen.findByText('Pat Star marked done for Waiver.')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('Medical release form'), { target: { value: 'Jersey check' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create item' }));
    await waitFor(() => expect(teamDetailServiceMocks.saveTeamTrackingItemForApp).toHaveBeenCalledWith('team-1', auth.user, {
      name: 'Jersey check',
      description: '',
      visibility: 'private',
      status: 'active'
    }, undefined));

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(teamDetailServiceMocks.archiveTeamTrackingItemForApp).toHaveBeenCalledWith('team-1', auth.user, 'item-1'));
  });

  it('links staff to the native awards studio from the team more tab', async () => {
    teamDetailServiceMocks.loadParentTeamDetail.mockResolvedValue({
      ...model,
      canManageTeam: true
    });

    render(
      <MemoryRouter initialEntries={['/teams/team-1']}>
        <Routes>
          <Route path="/teams/:teamId" element={<TeamDetail auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Bears' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /more/i }));

    expect((await screen.findByRole('link', { name: /edit team/i })).getAttribute('href')).toBe('/teams/team-1/edit');
    expect((await screen.findByRole('link', { name: /awards studio/i })).getAttribute('href')).toBe('/teams/team-1/certificates');
  });

  it('links staff to the native drill library from the team more tab', async () => {
    teamDetailServiceMocks.loadParentTeamDetail.mockResolvedValue({
      ...model,
      canManageTeam: true
    });

    render(
      <MemoryRouter initialEntries={['/teams/team-1']}>
        <Routes>
          <Route path="/teams/:teamId" element={<TeamDetail auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Bears' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /more/i }));

    expect((await screen.findByText('Drill library')).closest('a')?.getAttribute('href')).toBe('/teams/team-1/drills');
  });

  it('lets staff create a stat config from a preset and edit an existing config in the app', async () => {
    const managedModel = {
      ...model,
      canManageTeam: true,
      statTrackerConfigs: [{
        id: 'config-1',
        name: 'Soccer Standard',
        baseType: 'Soccer',
        isBasketball: false,
        columnCount: 5,
        columnNames: ['GOALS', 'SHOTS', 'SHOTS_ON_TARGET', 'ASSISTS', 'SAVES'],
        columns: ['GOALS', 'SHOTS', 'SHOTS_ON_TARGET', 'ASSISTS', 'SAVES'],
        statDefinitions: [
          { id: 'goals', label: 'GOALS', acronym: 'GOALS', type: 'base', group: 'Attack', scope: 'player', visibility: 'public', format: 'number', precision: 0, rankingOrder: 'desc', topStat: true },
          { id: 'shots', label: 'SHOTS', acronym: 'SHOTS', type: 'base', group: 'General', scope: 'player', visibility: 'public', format: 'number', precision: 0, rankingOrder: 'desc', topStat: false }
        ],
        assignedUpcomingGames: []
      }]
    };
    teamDetailServiceMocks.loadParentTeamDetail
      .mockResolvedValueOnce({ ...managedModel, statTrackerConfigs: [] })
      .mockResolvedValueOnce(managedModel)
      .mockResolvedValueOnce(managedModel);

    render(
      <MemoryRouter initialEntries={['/teams/team-1?tab=more']}>
        <Routes>
          <Route path="/teams/:teamId" element={<TeamDetail auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Bears' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Create config' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Create config' }));
    fireEvent.change(screen.getByLabelText('Preset library'), { target: { value: 'basketball' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply preset' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create config' }));

    await waitFor(() => expect(teamDetailServiceMocks.createStatTrackerConfigForApp).toHaveBeenCalledWith('team-1', auth.user, expect.objectContaining({
      name: 'Basketball Standard',
      baseType: 'Basketball',
      columns: ['PTS', 'REB', 'AST', 'FGM', 'FGA', 'TO']
    })));

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const labelInputs = screen.getAllByPlaceholderText('PTS');
    fireEvent.change(labelInputs[0], { target: { value: 'Goals' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save config' }));

    await waitFor(() => expect(teamDetailServiceMocks.updateStatTrackerConfigForApp).toHaveBeenCalledWith('team-1', 'config-1', auth.user, expect.objectContaining({
      name: 'Soccer Standard',
      baseType: 'Soccer',
      columns: ['Goals', 'SHOTS', 'SHOTS_ON_TARGET', 'ASSISTS', 'SAVES'],
      statDefinitions: expect.arrayContaining([
        expect.objectContaining({ id: 'goals', label: 'Goals', acronym: 'Goals' })
      ])
    })));
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

  it('removes legacy staff link-out and supports native admin invite sharing and removal', async () => {
    const managedModel = {
      ...model,
      canManageTeam: true,
      canManageAdmins: true,
      staffPermissions: {
        staff: [{ label: 'owner@example.com', role: 'Owner' }, { label: 'coach@example.com', role: 'Admin' }],
        pendingInvites: [],
        helperPermissions: [],
        scorekeepingMode: 'selected',
        scorekeeperGrantTargets: [],
        videographerGrantTargets: [],
        hasAnyStaff: true
      }
    };
    teamDetailServiceMocks.loadParentTeamDetail.mockResolvedValue(managedModel);
    teamDetailServiceMocks.loadTeamStaffPermissions.mockResolvedValue(managedModel.staffPermissions);
    teamDetailServiceMocks.inviteTeamAdminForApp.mockResolvedValue({
      email: 'newcoach@example.com',
      status: 'fallback_code',
      code: 'CODE123',
      teamName: 'Bears',
      acceptInviteUrl: 'https://allplays.ai/app#/accept-invite?code=CODE123&type=admin'
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <MemoryRouter initialEntries={['/teams/team-1']}>
        <Routes>
          <Route path="/teams/:teamId" element={<TeamDetail auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Bears' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /more/i }));

    expect(screen.queryByRole('button', { name: 'Manage staff' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Admin email'), { target: { value: ' NewCoach@Example.com ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }));

    await waitFor(() => expect(teamDetailServiceMocks.inviteTeamAdminForApp).toHaveBeenCalledWith('team-1', 'newcoach@example.com', auth.user));
    fireEvent.click(await screen.findByRole('button', { name: 'Share invite' }));
    const { sharePublicUrl } = await import('../lib/publicActions');
    expect(sharePublicUrl).toHaveBeenCalledWith({
      title: 'Bears staff invite',
      text: 'Join Bears staff on ALL PLAYS',
      url: 'https://allplays.ai/app#/accept-invite?code=CODE123&type=admin',
      clipboardText: 'https://allplays.ai/app#/accept-invite?code=CODE123&type=admin'
    });

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(teamDetailServiceMocks.revokeTeamAdminAccessForApp).toHaveBeenCalledWith('team-1', 'coach@example.com', auth.user));
  });

  it('shows staff permissions read-only for team managers who cannot manage admins', async () => {
    const managerAuth: AuthState = {
      ...auth,
      user: { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] } as any,
      roles: ['coach'],
      isParent: false,
      isCoach: true
    };
    const managedModel = {
      ...model,
      canManageTeam: true,
      canManageAdmins: false,
      staffPermissions: {
        staff: [{ label: 'owner@example.com', role: 'Owner' }, { label: 'coach@example.com', role: 'Admin' }],
        pendingInvites: ['pending@example.com'],
        helperPermissions: [],
        scorekeepingMode: 'selected',
        scorekeeperGrantTargets: [],
        videographerGrantTargets: [],
        hasAnyStaff: true
      }
    };
    teamDetailServiceMocks.loadParentTeamDetail.mockResolvedValue(managedModel);
    teamDetailServiceMocks.loadTeamStaffPermissions.mockResolvedValue(managedModel.staffPermissions);

    render(
      <MemoryRouter initialEntries={['/teams/team-1']}>
        <Routes>
          <Route path="/teams/:teamId" element={<TeamDetail auth={managerAuth} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Bears' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /more/i }));

    expect(await screen.findByText('Only the team owner or a platform admin can add or remove team admins.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send invite' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });
});
