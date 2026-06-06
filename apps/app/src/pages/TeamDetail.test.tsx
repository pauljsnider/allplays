// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamDetail } from './TeamDetail';
import type { AuthState } from '../lib/types';

const teamDetailServiceMocks = vi.hoisted(() => ({
  buildPublicTeamGamesIcsUrl: vi.fn(() => 'https://calendar.example.test/team.ics'),
  canExposePublicFanFeed: vi.fn(() => true),
  grantScorekeeperAccessForApp: vi.fn(),
  grantVideographerAccessForApp: vi.fn(),
  inviteTeamAdminForApp: vi.fn(),
  loadParentTeamDetail: vi.fn(),
  loadTeamDetailInsights: vi.fn(),
  loadTeamDetailSponsors: vi.fn(),
  loadTeamStaffPermissions: vi.fn(),
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
    { id: 'player-1', name: 'Pat Star', number: '9', photoUrl: null, position: 'Guard', isLinked: true }
  ],
  linkedPlayers: [
    { id: 'player-1', name: 'Pat Star', number: '9', photoUrl: null, position: 'Guard', isLinked: true }
  ],
  upcomingEvents: [],
  recentResults: [],
  nextEvent: null,
  record: { label: '2100', wins: 4, losses: 2, ties: 0, gamesPlayed: 6, winPercentage: 66.7 },
  standings: { enabled: true, label: 'Standings', rows: [], currentRow: null },
  leaderboards: [],
  trackingSummaries: [],
  sponsors: [],
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
    teamDetailServiceMocks.loadTeamStaffPermissions.mockResolvedValue(null);
    teamDetailServiceMocks.inviteTeamAdminForApp.mockResolvedValue({ status: 'sent', email: 'coach@example.com' });
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
});
