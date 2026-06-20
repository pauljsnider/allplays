// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  addPlayer: vi.fn(),
  createConfig: vi.fn(),
  getAggregatedStatsForGames: vi.fn(),
  getAdSpaceSponsors: vi.fn(),
  getConfigs: vi.fn(),
  getGames: vi.fn(),
  inviteParent: vi.fn(),
  getLocalAttractionSponsors: vi.fn(),
  getPlayers: vi.fn(),
  getPlayerTrackingStatuses: vi.fn(),
  getPublicTrackingItems: vi.fn(),
  getRosterFieldDefinitions: vi.fn(),
  getTeam: vi.fn(),
  updateTeam: vi.fn(),
  grantScorekeeperAccess: vi.fn(),
  grantVideographerAccess: vi.fn(),
  inviteAdmin: vi.fn(),
  addTeamAdminEmail: vi.fn(),
  revokeScorekeeperAccess: vi.fn(),
  revokeVideographerAccess: vi.fn(),
  deactivatePlayer: vi.fn(),
  reactivatePlayer: vi.fn(),
  setPlayerPrivateRosterProfileFields: vi.fn(),
  updateConfig: vi.fn(),
  uploadPlayerPhoto: vi.fn(),
  uploadTeamPhoto: vi.fn()
}));

const firebaseMocks = vi.hoisted(() => ({
  collection: vi.fn(),
  db: {},
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn(),
  where: vi.fn()
}));

const authServiceMocks = vi.hoisted(() => ({
  firebaseAuth: { app: { options: { projectId: 'test-project' } } },
  getNativeAuthIdToken: vi.fn()
}));

vi.mock('../../../../js/db.js', () => dbMocks);
vi.mock('../../../../js/auth.js', () => ({ sendInviteEmail: vi.fn() }));
vi.mock('../../../../js/edit-team-admin-invites.js', () => ({ inviteExistingTeamAdmin: vi.fn() }));
vi.mock('../../../../js/firebase.js', () => firebaseMocks);
vi.mock('../../../../js/roster-profile-fields.js', () => ({
  normalizeRosterFieldDefinitions: vi.fn((value) => value),
  splitRosterProfileValuesByVisibility: vi.fn(() => ({ publicValues: {}, privateValues: {} })),
  validateRosterProfileValues: vi.fn(() => [])
}));
vi.mock('../../../../js/schedule-notifications.js', () => ({
  describeScheduleReminderWindow: vi.fn(() => '24 hours'),
  normalizeScheduleNotificationSettings: vi.fn((value) => ({ enabled: Boolean(value?.enabled), reminderHours: 24, delivery: 'team_chat' }))
}));
vi.mock('../../../../js/season-record.js', () => ({
  calculateSeasonRecord: vi.fn(() => ({ wins: 0, losses: 0, ties: 0 })),
  listSeasonLabels: vi.fn(() => [])
}));
vi.mock('../../../../js/native-standings.js', () => ({ computeNativeStandings: vi.fn(() => []) }));
vi.mock('../../../../js/stat-leaderboards.js', async () => {
  const actual = await vi.importActual<any>('../../../../js/stat-leaderboards.js');
  return {
    ...actual,
    buildPlayerLeaderboardSnapshot: vi.fn(() => ({ topStats: [] })),
    selectAnalyticsConfig: vi.fn(() => null)
  };
});
vi.mock('../../../../js/player-tracking-summary.js', () => ({ getVisiblePlayerTrackingSummary: vi.fn(() => []) }));
vi.mock('../../../../js/team-access.js', () => ({
  hasFullTeamAccess: vi.fn(() => true),
  normalizeAdminEmailList: vi.fn(() => [])
}));
vi.mock('../../../../js/team-staff-permissions.js', () => ({ buildTeamStaffPermissionsViewModel: vi.fn(() => ({ staff: [], pendingInvites: [], helperPermissions: [], hasAnyStaff: false })) }));
vi.mock('./authService', () => authServiceMocks);
vi.mock('./inviteUrls', () => ({ buildAppAcceptInviteUrl: vi.fn(() => 'https://allplays.ai/app#/accept-invite') }));
vi.mock('./nativeRestLogging', () => ({ sanitizeErrorForLogging: vi.fn((error) => error) }));

import { __resetTeamDetailBaseSnapshotCacheForTests, createStatTrackerConfigForApp } from './teamDetailService';

describe('createStatTrackerConfigForApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    Object.defineProperty(window, 'location', {
      value: { protocol: 'capacitor:' },
      writable: true,
      configurable: true
    });
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', ownerId: 'owner-1' });
    dbMocks.getPlayers.mockResolvedValue([]);
    dbMocks.getGames.mockResolvedValue([]);
    dbMocks.getConfigs.mockResolvedValue([]);
    authServiceMocks.getNativeAuthIdToken.mockResolvedValue('native-token');
    (globalThis as any).fetch = vi.fn();
    __resetTeamDetailBaseSnapshotCacheForTests();
  });

  it('waits for a timed-out native create to finish instead of issuing a duplicate REST create', async () => {
    dbMocks.createConfig.mockImplementation(() => new Promise((resolve) => {
      window.setTimeout(() => resolve('config-1'), 5100);
    }));

    const savePromise = createStatTrackerConfigForApp('team-1', { uid: 'owner-1' } as any, {
      name: 'Custom Config',
      baseType: 'Custom',
      columns: ['PTS'],
      statDefinitions: []
    });

    await vi.advanceTimersByTimeAsync(5200);

    await expect(savePromise).resolves.toBe('config-1');
    expect(dbMocks.createConfig).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
