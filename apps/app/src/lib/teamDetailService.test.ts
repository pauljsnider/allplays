// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveAgeClassification, getDiamondLeaderboardQualification } from './teamDetailService';

describe('deriveAgeClassification', () => {
  it('uses age group, birth year, grade, then birth date year in precedence order', () => {
    expect(deriveAgeClassification({ ageGroup: 'U12', birthYear: '2014', grade: '6', birthDate: '2014-02-03' })).toBe('U12');
    expect(deriveAgeClassification({ birthYear: '2014', grade: '6', birthDate: '2014-02-03' })).toBe('Birth year 2014');
    expect(deriveAgeClassification({ grade: '6', birthDate: '2014-02-03' })).toBe('Grade 6');
    expect(deriveAgeClassification({ birthDate: '2014-02-03' })).toBe('Birth year 2014');
  });

  it('uses privileged roster values without returning the full birth date', () => {
    const classification = deriveAgeClassification({ privateProfileRosterFields: { grade: '6', birthDate: '2014-02-03' } });
    expect(classification).toBe('Grade 6');
    expect(classification).not.toContain('2014-02-03');
    expect(deriveAgeClassification({ privateProfileRosterFields: {} })).toBe('');
  });
});

describe('Diamond leaderboard qualification', () => {
  it('requires complete denominator evidence and the team-game PA threshold for rates', () => {
    const batting = getDiamondLeaderboardQualification({ id: 'avg', formula: 'H/AB' }, 4);
    expect(batting.label).toBe('9 PA minimum (2.1/team game)');
    expect(batting.qualifies({ pa: 8, ab: 8, h: 8 })).toBe(false);
    expect(batting.qualifies({ pa: 9, ab: 0, h: 0 })).toBe(false);
    expect(batting.qualifies({ pa: 9, ab: 8, h: 3 })).toBe(true);

    const stealRate = getDiamondLeaderboardQualification({ id: 'stolen_base_rate', formula: 'SB/(SB+CS)' }, 4);
    expect(stealRate.qualifies({ sb: 0, cs: 0 })).toBe(false);
    expect(stealRate.qualifies({ sb: 1, cs: 0 })).toBe(true);

    const unsupported = getDiamondLeaderboardQualification({ id: 'model_rate', formula: 'MODEL' }, 4);
    expect(unsupported.qualifies({ model_rate: 1 })).toBe(false);
  });
});

const dbMocks = vi.hoisted(() => ({
  addPlayer: vi.fn(),
  applyRosterCsvImportOperations: vi.fn(),
  createConfig: vi.fn(),
  deleteLegacyImageUpload: vi.fn(),
  getAggregatedStatsForGames: vi.fn(),
  getAdSpaceSponsors: vi.fn(),
  getConfigs: vi.fn(),
  getGames: vi.fn(),
  inviteParent: vi.fn(),
  getLocalAttractionSponsors: vi.fn(),
  getPlayers: vi.fn(),
  getPlayersWithPrivateRosterContacts: vi.fn(),
  getPlayerPrivateProfile: vi.fn(),
  getPlayerTrackingStatuses: vi.fn(),
  getPublicTrackingItems: vi.fn(),
  getRosterFieldDefinitions: vi.fn(),
  getTeam: vi.fn(),
  setTeamTrackingStatus: vi.fn(),
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
  functions: {},
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  httpsCallable: vi.fn(),
  query: vi.fn(),
  serverTimestamp: vi.fn(() => 'server-timestamp'),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  where: vi.fn()
}));

const authServiceMocks = vi.hoisted(() => ({
  firebaseAuth: { app: { options: { projectId: 'test-project' } } },
  getNativeAuthIdToken: vi.fn()
}));

const scheduleServiceMocks = vi.hoisted(() => ({
  loadTeamOverviewSchedule: vi.fn()
}));
const nativeRuntimeState = vi.hoisted(() => ({ isNative: false }));
const nativeStorageMocks = vi.hoisted(() => ({
  deleteNativePrimaryStorageFile: vi.fn(),
  uploadNativePlayerPhotoFile: vi.fn(),
  uploadNativeTeamPhotoFile: vi.fn()
}));
const nativeFirestoreMutationMocks = vi.hoisted(() => ({
  commitNativeFirestoreWrites: vi.fn(),
  createNativeFirestoreDocumentId: vi.fn(() => 'native-player-1')
}));
const nativeCallableMocks = vi.hoisted(() => ({
  callNativeFirebaseFunction: vi.fn()
}));
const diamondManagerStatsMocks = vi.hoisted(() => ({
  loadDiamondManagerStats: vi.fn()
}));
const diamondStatConfigSnapshotMocks = vi.hoisted(() => ({
  buildActivationPinnedDiamondPresentationConfig: vi.fn((config: any) => config),
  currentDiamondStatConfigMatchesActivation: vi.fn((_input?: any) => true)
}));

const seasonRecordMocks = vi.hoisted(() => ({
  calculateSeasonRecord: vi.fn(() => ({ wins: 0, losses: 0, ties: 0 })),
  getTeamScorePair: vi.fn((game: any) => {
    const useStoredScoreOrder = Boolean(String(game?.sharedScheduleSourceTeamId || '').trim()) || game?.isHome !== false;
    return {
      teamScore: useStoredScoreOrder ? game?.homeScore : game?.awayScore,
      opponentScore: useStoredScoreOrder ? game?.awayScore : game?.homeScore
    };
  }),
  listSeasonLabels: vi.fn((): string[] => [])
}));

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: vi.fn(() => false), getPlatform: vi.fn(() => 'web') } }));
vi.mock('@capacitor-firebase/authentication', () => ({ FirebaseAuthentication: {} }));
vi.mock('../../../../js/db.js', () => dbMocks);
vi.mock('../../../../js/auth.js', () => ({ sendInviteEmail: vi.fn() }));
vi.mock('../../../../js/edit-team-admin-invites.js', () => ({ inviteExistingTeamAdmin: vi.fn() }));
vi.mock('../../../../js/firebase.js', () => firebaseMocks);
vi.mock('../../../../js/roster-profile-fields.js', () => ({
  collectRosterParentContacts: vi.fn((player: any, options: any = {}) => {
    const contacts = [
      ...(Array.isArray(player?.parents) ? player.parents : []),
      ...(Array.isArray(player?.privateProfileParents) ? player.privateProfileParents : []),
      ...(options.includeFamilyContacts && Array.isArray(player?.privateProfileContacts) ? player.privateProfileContacts : [])
    ];
    return contacts.filter((contact: any) => options.includeImported !== false || contact?.source !== 'roster-csv');
  }),
  getRosterAiImportFieldCatalog: vi.fn(() => []),
  mergeStandardRosterFieldDefinitions: vi.fn((value) => value),
  normalizeRosterFieldDefinitions: vi.fn((value) => value),
  planRosterAiImport: vi.fn(() => ({ operations: [], errors: [] })),
  splitRosterProfileValuesByVisibility: vi.fn(() => ({ publicValues: {}, privateValues: {} })),
  validateRosterProfileValues: vi.fn(() => [])
}));
vi.mock('../../../../js/schedule-notifications.js', () => ({
  describeScheduleReminderWindow: vi.fn(() => '24 hours'),
  normalizeScheduleNotificationSettings: vi.fn((value) => ({ enabled: Boolean(value?.enabled), reminderHours: 24, delivery: 'team_chat' }))
}));
vi.mock('../../../../js/season-record.js', () => seasonRecordMocks);
vi.mock('../../../../js/native-standings.js', () => ({ computeNativeStandings: vi.fn(() => []) }));
vi.mock('../../../../js/stat-leaderboards.js', async () => {
  const actual = await vi.importActual<any>('../../../../js/stat-leaderboards.js');
  return {
    ...actual,
    buildPlayerLeaderboardSnapshot: vi.fn(() => ({ topStats: [] })),
    selectAnalyticsConfig: vi.fn(() => null)
  };
});
vi.mock('../../../../js/player-tracking-summary.js', () => ({
  getVisiblePlayerTrackingSummary: vi.fn(() => []),
  normalizeTrackingStatus: vi.fn((status) => ({
    ...status,
    itemId: status.itemId || status.trackingItemId || status.id || '',
    playerId: status.playerId || status.childId || status.memberId || '',
    isComplete: status.complete === true || status.isComplete === true || status.status === 'complete'
  }))
}));
vi.mock('../../../../js/team-access.js', () => ({
  hasFullTeamAccess: vi.fn(() => true),
  normalizeAdminEmailList: vi.fn((adminEmails: unknown) => Array.from(new Set(
    (Array.isArray(adminEmails) ? adminEmails : [])
      .map((email) => String(email || '').trim().toLowerCase())
      .filter(Boolean)
  )))
}));
vi.mock('../../../../js/team-staff-permissions.js', () => ({ buildTeamStaffPermissionsViewModel: vi.fn(() => ({ staff: [], pendingInvites: [], helperPermissions: [], hasAnyStaff: false })) }));
vi.mock('./authService', () => authServiceMocks);
vi.mock('./inviteUrls', () => ({ buildAppAcceptInviteUrl: vi.fn(() => 'https://allplays.ai/app/#/accept-invite') }));
vi.mock('./nativeRuntime', () => ({ isNativeRuntime: () => nativeRuntimeState.isNative }));
vi.mock('./nativeStorageUpload', () => nativeStorageMocks);
vi.mock('./nativeFirestoreMutation', () => nativeFirestoreMutationMocks);
vi.mock('./nativeCallable', () => nativeCallableMocks);
vi.mock('./nativeRestLogging', () => ({ sanitizeErrorForLogging: vi.fn((error) => error) }));
vi.mock('./profileService', () => ({ loadProfileDocument: vi.fn(async () => ({})) }));
vi.mock('./scheduleService', () => scheduleServiceMocks);
vi.mock('./diamondManagerStatsService', () => ({
  DIAMOND_MANAGER_STATS_MAX_GAMES: 40,
  DIAMOND_MANAGER_STATS_MAX_PLAYERS: 25,
  loadDiamondManagerStats: diamondManagerStatsMocks.loadDiamondManagerStats
}));
vi.mock('./diamondStatConfigSnapshot', () => diamondStatConfigSnapshotMocks);

import {
  __resetTeamDetailBaseSnapshotCacheForTests,
  addRosterPlayerForApp,
  buildTeamAnalytics,
  buildTeamDetailModel,
  createStatTrackerConfigForApp,
  isEligiblePrivateCalendarSubscriberForApp,
  loadParentTeamDetail,
  loadParentTeamDetailBootstrap,
  loadTeamDetailInsights,
  loadTeamTrackingAdmin,
  revokeTeamAdminAccessForApp,
  saveTeamTrackingItemForApp,
  setPlayerTrackingStatusForApp,
  updateTeamSettingsForApp
} from './teamDetailService';
import { computeNativeStandings } from '../../../../js/native-standings.js';
import { hasFullTeamAccess } from '../../../../js/team-access.js';
import { buildPlayerLeaderboardSnapshot, selectAnalyticsConfig } from '../../../../js/stat-leaderboards.js';

describe('buildTeamAnalytics', () => {
  it('builds chronological score trends, recent form, averages, and differential', () => {
    const analytics = buildTeamAnalytics([
      { id: 'game-3', status: 'completed', date: '2026-03-03T18:00:00Z', opponent: 'Owls', homeScore: 2, awayScore: 2 },
      { id: 'game-1', status: 'completed', date: '2026-03-01T18:00:00Z', opponent: 'Bears', homeScore: 4, awayScore: 1 },
      { id: 'game-2', status: 'completed', date: '2026-03-02T18:00:00Z', opponent: 'Cats', homeScore: 1, awayScore: 3 }
    ]);

    expect(analytics).toMatchObject({
      seasonLabel: '2026',
      completedGameCount: 3,
      recentWins: 1,
      recentLosses: 1,
      recentTies: 1,
      averagePointsFor: 2.3,
      averagePointsAgainst: 2,
      scoreDifferential: 1
    });
    expect(analytics.progression.map((game) => game.id)).toEqual(['game-1', 'game-2', 'game-3']);
    expect(analytics.progression.map((game) => game.result)).toEqual(['W', 'L', 'T']);
  });

  it('accepts live-completed games and ignores games without final scores', () => {
    const analytics = buildTeamAnalytics([
      { id: 'live-finished', status: 'scheduled', liveStatus: 'completed', date: '2026-03-01T18:00:00Z', homeScore: 5, awayScore: 4 },
      { id: 'no-score', status: 'completed', date: '2026-03-02T18:00:00Z' },
      { id: 'practice', type: 'practice', status: 'completed', date: '2026-03-03T18:00:00Z', homeScore: 1, awayScore: 0 }
    ]);

    expect(analytics.completedGameCount).toBe(1);
    expect(analytics.progression[0]).toMatchObject({ id: 'live-finished', result: 'W', differential: 1 });
  });

  it('orders the team score correctly for completed away games', () => {
    const analytics = buildTeamAnalytics([
      { id: 'away-win', status: 'completed', isHome: false, date: '2026-03-04T18:00:00Z', opponent: 'Bears', homeScore: 68, awayScore: 71 }
    ], '2026');

    expect(analytics.progression[0]).toMatchObject({
      id: 'away-win',
      pointsFor: 71,
      pointsAgainst: 68,
      result: 'W',
      differential: 3
    });
    expect(analytics.scoreDifferential).toBe(3);
  });

  it('preserves team-oriented score order for shared-schedule away mirrors', () => {
    const analytics = buildTeamAnalytics([{
      id: 'mirrored-away-win',
      status: 'completed',
      isHome: false,
      date: '2026-03-04T18:00:00Z',
      opponent: 'Bears',
      homeScore: 71,
      awayScore: 68,
      sharedScheduleSourceTeamId: 'team-alpha'
    }], '2026');

    expect(analytics.progression[0]).toMatchObject({
      id: 'mirrored-away-win',
      pointsFor: 71,
      pointsAgainst: 68,
      result: 'W',
      differential: 3
    });
  });

  it('returns an explicit empty snapshot without completed score-bearing games', () => {
    expect(buildTeamAnalytics([])).toEqual({
      seasonLabel: String(new Date().getFullYear()),
      completedGameCount: 0,
      recentWins: 0,
      recentLosses: 0,
      recentTies: 0,
      averagePointsFor: 0,
      averagePointsAgainst: 0,
      scoreDifferential: 0,
      recentForm: [],
      progression: [],
      availableSeasons: [],
      seasons: []
    });
  });

  it('keeps season snapshots separate and honors the preferred season', () => {
    const analytics = buildTeamAnalytics([
      { id: 'older', status: 'completed', seasonLabel: '2025', date: '2025-10-01T18:00:00Z', homeScore: 5, awayScore: 0 },
      { id: 'current', status: 'completed', seasonLabel: '2026', date: '2026-03-01T18:00:00Z', homeScore: 1, awayScore: 3 }
    ], '2026');

    expect(analytics.availableSeasons).toEqual(['2026', '2025']);
    expect(analytics.seasonLabel).toBe('2026');
    expect(analytics.completedGameCount).toBe(1);
    expect(analytics.scoreDifferential).toBe(-2);
    expect(analytics.seasons.map((season) => [season.seasonLabel, season.completedGameCount])).toEqual([['2026', 1], ['2025', 1]]);
  });

  it('keeps the preferred season selected when only an older season has final scores', () => {
    const analytics = buildTeamAnalytics([
      { id: 'older', status: 'completed', seasonLabel: '2025', date: '2025-10-01T18:00:00Z', homeScore: 5, awayScore: 0 },
      { id: 'scheduled-current', status: 'scheduled', seasonLabel: '2026', date: '2026-03-01T18:00:00Z' }
    ], '2026');

    expect(analytics.seasonLabel).toBe('2026');
    expect(analytics.completedGameCount).toBe(0);
    expect(analytics.availableSeasons).toEqual(['2026', '2025']);
    expect(analytics.seasons.map((season) => [season.seasonLabel, season.completedGameCount])).toEqual([['2026', 0], ['2025', 1]]);
  });
});

beforeEach(() => {
  nativeRuntimeState.isNative = false;
  diamondStatConfigSnapshotMocks.buildActivationPinnedDiamondPresentationConfig.mockImplementation((config: any) => config);
  diamondStatConfigSnapshotMocks.currentDiamondStatConfigMatchesActivation.mockImplementation(() => true);
  firebaseMocks.httpsCallable.mockReturnValue(vi.fn().mockResolvedValue({ data: { success: true } }));
  vi.mocked(hasFullTeamAccess).mockImplementation(() => true);
  vi.mocked(selectAnalyticsConfig).mockReturnValue(null);
  vi.mocked(buildPlayerLeaderboardSnapshot).mockReturnValue({ topStats: [] } as any);
  diamondManagerStatsMocks.loadDiamondManagerStats.mockResolvedValue({
    status: 'unavailable',
    reason: 'private-read-unavailable',
    documentsByGameId: new Map(),
    teamDocumentsByGameId: new Map()
  });
  seasonRecordMocks.listSeasonLabels.mockReturnValue([]);
  dbMocks.getPlayersWithPrivateRosterContacts.mockImplementation((_teamId: string, options: any = {}) => (
    Array.isArray(options.players) ? options.players : dbMocks.getPlayers(_teamId, options)
  ));
  dbMocks.getPlayerPrivateProfile.mockResolvedValue(null);
});

describe('createStatTrackerConfigForApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    nativeRuntimeState.isNative = true;
    Object.defineProperty(window, 'location', {
      value: { protocol: 'capacitor:' },
      writable: true,
      configurable: true
    });
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', ownerId: 'owner-1' });
    dbMocks.getPlayersWithPrivateRosterContacts.mockImplementation((_teamId: string, options: any = {}) => (
      Array.isArray(options.players) ? options.players : dbMocks.getPlayers(_teamId, options)
    ));
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

describe('updateTeamSettingsForApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nativeRuntimeState.isNative = false;
    dbMocks.getTeam.mockResolvedValue({
      id: 'team-1',
      ownerId: 'owner-1',
      photoUrl: 'https://img.example.test/team.png',
      photoPath: 'profile-photos/teams/team-1/team/old.jpg'
    });
    dbMocks.getPlayersWithPrivateRosterContacts.mockImplementation((_teamId: string, options: any = {}) => (
      Array.isArray(options.players) ? options.players : dbMocks.getPlayers(_teamId, options)
    ));
    dbMocks.getPlayers.mockResolvedValue([]);
    dbMocks.getGames.mockResolvedValue([]);
    dbMocks.getConfigs.mockResolvedValue([]);
    __resetTeamDetailBaseSnapshotCacheForTests();
  });

  it('writes only the normalized link fields when saving team links', async () => {
    await updateTeamSettingsForApp('team-1', { uid: 'owner-1' } as any, {
      name: 'Bears',
      sport: 'Basketball',
      zip: '66210',
      isPublic: true,
      leagueUrl: ' http://league.example.test/standings ',
      streamUrl: 'https://youtu.be/LJNfHqRRhBI'
    });

    expect(dbMocks.updateTeam).toHaveBeenCalledWith('team-1', expect.objectContaining({
      leagueUrl: 'http://league.example.test/standings',
      twitchChannel: null,
      streamEmbedUrl: 'https://www.youtube.com/embed/LJNfHqRRhBI?autoplay=1&mute=1',
      youtubeEmbedUrl: null
    }));
  });

  it('clears link fields with null values when a staff user removes them', async () => {
    await updateTeamSettingsForApp('team-1', { uid: 'owner-1' } as any, {
      name: 'Bears',
      leagueUrl: '',
      streamUrl: ''
    });

    expect(dbMocks.updateTeam).toHaveBeenCalledWith('team-1', expect.objectContaining({
      leagueUrl: null,
      twitchChannel: null,
      streamEmbedUrl: null,
      youtubeEmbedUrl: null
    }));
  });

  it('binds a browser team photo upload to the team and primary Storage contract', async () => {
    dbMocks.uploadTeamPhoto.mockResolvedValueOnce({
      url: 'https://primary.example/team.jpg',
      path: 'profile-photos/teams/team-1/team/team.jpg'
    });
    const file = new File(['photo'], 'team.jpg', { type: 'image/jpeg' });

    await updateTeamSettingsForApp('team-1', { uid: 'owner-1' } as any, {
      name: 'Bears',
      photoFile: file
    });

    expect(dbMocks.uploadTeamPhoto).toHaveBeenCalledWith(file, { returnUpload: true, teamId: 'team-1' });
    expect(dbMocks.updateTeam).toHaveBeenCalledWith('team-1', expect.objectContaining({
      photoUrl: 'https://primary.example/team.jpg',
      photoPath: 'profile-photos/teams/team-1/team/team.jpg'
    }));
    expect(dbMocks.deleteLegacyImageUpload).toHaveBeenCalledWith('profile-photos/teams/team-1/team/old.jpg');
  });

  it('rejects invalid livestream links before writing', async () => {
    await expect(updateTeamSettingsForApp('team-1', { uid: 'owner-1' } as any, {
      name: 'Bears',
      streamUrl: 'not a stream url'
    })).rejects.toThrow('Livestream link must be a valid YouTube or Twitch URL.');

    expect(dbMocks.updateTeam).not.toHaveBeenCalled();
  });

  it.each([
    ['browser', false],
    ['native', true]
  ])('blocks a third sport on a mismatched Diamond team before the %s upload or settings write', async (_surface, isNative) => {
    nativeRuntimeState.isNative = isNative;
    dbMocks.getTeam.mockResolvedValue({
      id: 'team-1',
      ownerId: 'owner-1',
      sport: 'Soccer',
      diamondScorebook: {
        enabled: true,
        sport: 'baseball',
        rulesProfileId: 'baseball-youth',
        rulesProfileVersion: 1,
        captureMode: 'quick'
      },
      photoUrl: 'https://img.example.test/team.png',
      photoPath: 'profile-photos/teams/team-1/team/old.jpg'
    });
    const photoFile = new File(['photo'], 'team.jpg', { type: 'image/jpeg' });

    await expect(updateTeamSettingsForApp('team-1', { uid: 'owner-1' } as any, {
      name: 'Bears',
      sport: 'Basketball',
      photoFile
    })).rejects.toThrow('Diamond Scorebook v2 is enrolled for baseball');

    expect(dbMocks.uploadTeamPhoto).not.toHaveBeenCalled();
    expect(nativeStorageMocks.uploadNativeTeamPhotoFile).not.toHaveBeenCalled();
    expect(dbMocks.updateTeam).not.toHaveBeenCalled();
    expect(nativeFirestoreMutationMocks.commitNativeFirestoreWrites).not.toHaveBeenCalled();
    expect(dbMocks.deleteLegacyImageUpload).not.toHaveBeenCalled();
    expect(nativeStorageMocks.deleteNativePrimaryStorageFile).not.toHaveBeenCalled();
  });

  it.each([
    ['browser', false],
    ['native', true]
  ])('allows the %s app to repair a Diamond mismatch back to the stored enrollment sport', async (_surface, isNative) => {
    nativeRuntimeState.isNative = isNative;
    dbMocks.getTeam.mockResolvedValue({
      id: 'team-1',
      ownerId: 'owner-1',
      sport: 'Soccer',
      diamondScorebook: {
        enabled: true,
        sport: 'baseball',
        rulesProfileId: 'baseball-youth',
        rulesProfileVersion: 1,
        captureMode: 'quick'
      }
    });

    await updateTeamSettingsForApp('team-1', { uid: 'owner-1' } as any, {
      name: 'Bears',
      sport: 'Baseball'
    });

    if (isNative) {
      expect(nativeFirestoreMutationMocks.commitNativeFirestoreWrites).toHaveBeenCalledWith([
        expect.objectContaining({
          pathSegments: ['teams', 'team-1'],
          data: expect.objectContaining({ sport: 'Baseball' })
        })
      ]);
      expect(dbMocks.updateTeam).not.toHaveBeenCalled();
    } else {
      expect(dbMocks.updateTeam).toHaveBeenCalledWith('team-1', expect.objectContaining({ sport: 'Baseball' }));
      expect(nativeFirestoreMutationMocks.commitNativeFirestoreWrites).not.toHaveBeenCalled();
    }
  });

  it('preserves the enrolled Diamond sport when an app or Private AI edit omits it', async () => {
    dbMocks.getTeam.mockResolvedValue({
      id: 'team-1',
      ownerId: 'owner-1',
      sport: 'Baseball',
      diamondScorebook: { enabled: true, sport: 'baseball' }
    });

    await updateTeamSettingsForApp('team-1', { uid: 'owner-1' } as any, {
      name: 'Bears Updated'
    });

    expect(dbMocks.updateTeam).toHaveBeenCalledWith('team-1', expect.objectContaining({
      name: 'Bears Updated',
      sport: 'Baseball'
    }));
  });

  it('preserves classic team sport changes when Diamond is not enrolled', async () => {
    dbMocks.getTeam.mockResolvedValue({
      id: 'team-1',
      ownerId: 'owner-1',
      sport: 'Basketball'
    });

    await updateTeamSettingsForApp('team-1', { uid: 'owner-1' } as any, {
      name: 'Bears',
      sport: 'Soccer'
    });

    expect(dbMocks.updateTeam).toHaveBeenCalledWith('team-1', expect.objectContaining({
      sport: 'Soccer'
    }));
  });

  it('uses native Storage and an authenticated REST commit for a team photo', async () => {
    nativeRuntimeState.isNative = true;
    nativeStorageMocks.uploadNativeTeamPhotoFile.mockResolvedValue({
      url: 'https://primary.example/team.jpg',
      path: 'profile-photos/teams/team-1/team/team.jpg'
    });
    const file = new File(['photo'], 'team.jpg', { type: 'image/jpeg' });

    await updateTeamSettingsForApp('team-1', { uid: 'owner-1' } as any, {
      name: 'Bears',
      photoFile: file
    });

    expect(nativeStorageMocks.uploadNativeTeamPhotoFile).toHaveBeenCalledWith(file, 'team-1');
    expect(nativeFirestoreMutationMocks.commitNativeFirestoreWrites).toHaveBeenCalledWith([
      expect.objectContaining({
        pathSegments: ['teams', 'team-1'],
        data: expect.objectContaining({
          photoUrl: 'https://primary.example/team.jpg',
          photoPath: 'profile-photos/teams/team-1/team/team.jpg'
        })
      })
    ]);
    expect(nativeStorageMocks.deleteNativePrimaryStorageFile).toHaveBeenCalledWith('profile-photos/teams/team-1/team/old.jpg');
    expect(dbMocks.uploadTeamPhoto).not.toHaveBeenCalled();
    expect(dbMocks.updateTeam).not.toHaveBeenCalled();
  });

  it('keeps a native team photo when the settings commit outcome is uncertain', async () => {
    nativeRuntimeState.isNative = true;
    dbMocks.getTeam
      .mockResolvedValueOnce({
        id: 'team-1',
        ownerId: 'owner-1',
        photoUrl: 'https://img.example.test/team.png',
        photoPath: 'profile-photos/teams/team-1/team/old.jpg'
      })
      .mockRejectedValueOnce(new Error('confirmation read unavailable'));
    nativeStorageMocks.uploadNativeTeamPhotoFile.mockResolvedValue({
      url: 'https://primary.example/team.jpg',
      path: 'profile-photos/teams/team-1/team/team.jpg'
    });
    nativeFirestoreMutationMocks.commitNativeFirestoreWrites.mockRejectedValueOnce(
      Object.assign(new Error('The save may have completed.'), { commitStateUnknown: true })
    );

    await expect(updateTeamSettingsForApp('team-1', { uid: 'owner-1' } as any, {
      name: 'Bears',
      photoFile: new File(['photo'], 'team.jpg', { type: 'image/jpeg' })
    })).rejects.toThrow('may have completed');

    expect(nativeStorageMocks.deleteNativePrimaryStorageFile).not.toHaveBeenCalled();
  });

  it('accepts an ambiguous native team save only after the new path is authoritative', async () => {
    nativeRuntimeState.isNative = true;
    const newPath = 'profile-photos/teams/team-1/team/team.jpg';
    dbMocks.getTeam
      .mockResolvedValueOnce({
        id: 'team-1',
        ownerId: 'owner-1',
        photoUrl: 'https://img.example.test/team.png',
        photoPath: 'profile-photos/teams/team-1/team/old.jpg'
      })
      .mockResolvedValueOnce({ id: 'team-1', ownerId: 'owner-1', photoPath: newPath });
    nativeStorageMocks.uploadNativeTeamPhotoFile.mockResolvedValue({
      url: 'https://primary.example/team.jpg',
      path: newPath
    });
    nativeFirestoreMutationMocks.commitNativeFirestoreWrites.mockRejectedValueOnce(
      Object.assign(new Error('The save may have completed.'), { commitStateUnknown: true })
    );

    await expect(updateTeamSettingsForApp('team-1', { uid: 'owner-1' } as any, {
      name: 'Bears',
      photoFile: new File(['photo'], 'team.jpg', { type: 'image/jpeg' })
    })).resolves.toBeUndefined();

    expect(nativeStorageMocks.deleteNativePrimaryStorageFile).toHaveBeenCalledWith('profile-photos/teams/team-1/team/old.jpg');
    expect(nativeStorageMocks.deleteNativePrimaryStorageFile).not.toHaveBeenCalledWith(newPath);
  });

  it('removes an uncommitted native team photo after an authoritative re-read', async () => {
    nativeRuntimeState.isNative = true;
    const oldTeam = {
      id: 'team-1',
      ownerId: 'owner-1',
      photoUrl: 'https://img.example.test/team.png',
      photoPath: 'profile-photos/teams/team-1/team/old.jpg'
    };
    dbMocks.getTeam.mockResolvedValueOnce(oldTeam).mockResolvedValueOnce(oldTeam);
    nativeStorageMocks.uploadNativeTeamPhotoFile.mockResolvedValue({
      url: 'https://primary.example/team.jpg',
      path: 'profile-photos/teams/team-1/team/team.jpg'
    });
    nativeFirestoreMutationMocks.commitNativeFirestoreWrites.mockRejectedValueOnce(
      Object.assign(new Error('The save may have completed.'), { commitStateUnknown: true })
    );

    await expect(updateTeamSettingsForApp('team-1', { uid: 'owner-1' } as any, {
      name: 'Bears',
      photoFile: new File(['photo'], 'team.jpg', { type: 'image/jpeg' })
    })).rejects.toThrow('may have completed');

    expect(nativeStorageMocks.deleteNativePrimaryStorageFile).toHaveBeenCalledWith('profile-photos/teams/team-1/team/team.jpg');
    expect(nativeStorageMocks.deleteNativePrimaryStorageFile).not.toHaveBeenCalledWith('profile-photos/teams/team-1/team/old.jpg');
  });

  it('keeps a browser team photo when the document save outcome is uncertain', async () => {
    dbMocks.getTeam
      .mockResolvedValueOnce({
        id: 'team-1',
        ownerId: 'owner-1',
        photoUrl: 'https://img.example.test/team.png',
        photoPath: 'profile-photos/teams/team-1/team/old.jpg'
      })
      .mockRejectedValueOnce(new Error('confirmation read unavailable'));
    dbMocks.uploadTeamPhoto.mockResolvedValueOnce({
      url: 'https://primary.example/team.jpg',
      path: 'profile-photos/teams/team-1/team/team.jpg'
    });
    dbMocks.updateTeam.mockRejectedValueOnce(Object.assign(new Error('network unavailable'), { code: 'unavailable' }));

    await expect(updateTeamSettingsForApp('team-1', { uid: 'owner-1' } as any, {
      name: 'Bears',
      photoFile: new File(['photo'], 'team.jpg', { type: 'image/jpeg' })
    })).rejects.toThrow('network unavailable');

    expect(dbMocks.deleteLegacyImageUpload).not.toHaveBeenCalled();
  });

  it('accepts an ambiguous browser team save only after the new path is authoritative', async () => {
    const newPath = 'profile-photos/teams/team-1/team/team.jpg';
    dbMocks.getTeam
      .mockResolvedValueOnce({
        id: 'team-1',
        ownerId: 'owner-1',
        photoUrl: 'https://img.example.test/team.png',
        photoPath: 'profile-photos/teams/team-1/team/old.jpg'
      })
      .mockResolvedValueOnce({ id: 'team-1', ownerId: 'owner-1', photoPath: newPath });
    dbMocks.uploadTeamPhoto.mockResolvedValueOnce({
      url: 'https://primary.example/team.jpg',
      path: newPath
    });
    dbMocks.updateTeam.mockRejectedValueOnce(Object.assign(new Error('network unavailable'), { code: 'unavailable' }));

    await expect(updateTeamSettingsForApp('team-1', { uid: 'owner-1' } as any, {
      name: 'Bears',
      photoFile: new File(['photo'], 'team.jpg', { type: 'image/jpeg' })
    })).resolves.toBeUndefined();

    expect(dbMocks.deleteLegacyImageUpload).toHaveBeenCalledWith('profile-photos/teams/team-1/team/old.jpg');
    expect(dbMocks.deleteLegacyImageUpload).not.toHaveBeenCalledWith(newPath);
  });

  it('removes a browser team photo when the document save definitely failed', async () => {
    dbMocks.uploadTeamPhoto.mockResolvedValueOnce({
      url: 'https://primary.example/team.jpg',
      path: 'profile-photos/teams/team-1/team/team.jpg'
    });
    dbMocks.updateTeam.mockRejectedValueOnce(Object.assign(new Error('save denied'), { code: 'firestore/permission-denied' }));

    await expect(updateTeamSettingsForApp('team-1', { uid: 'owner-1' } as any, {
      name: 'Bears',
      photoFile: new File(['photo'], 'team.jpg', { type: 'image/jpeg' })
    })).rejects.toThrow('save denied');

    expect(dbMocks.deleteLegacyImageUpload).toHaveBeenCalledWith('profile-photos/teams/team-1/team/team.jpg');
  });
});

describe('addRosterPlayerForApp native writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nativeRuntimeState.isNative = true;
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', ownerId: 'owner-1' });
    dbMocks.getPlayers.mockResolvedValue([]);
    dbMocks.getGames.mockResolvedValue([]);
    dbMocks.getConfigs.mockResolvedValue([]);
    dbMocks.getRosterFieldDefinitions.mockResolvedValue([]);
    nativeStorageMocks.uploadNativePlayerPhotoFile.mockResolvedValue({
      url: 'https://primary.example/player.jpg',
      path: 'profile-photos/teams/team-1/players/native-player-1/player.jpg'
    });
    __resetTeamDetailBaseSnapshotCacheForTests();
  });

  it.each([
    ['a non-image file', new File(['text'], 'player.txt', { type: 'text/plain' })],
    ['an empty image', new File([], 'player.jpg', { type: 'image/jpeg' })],
    ['an oversized image', new File([new Uint8Array((5 * 1024 * 1024) + 1)], 'player.jpg', { type: 'image/jpeg' })]
  ])('rejects %s before creating the native player owner', async (_label, photoFile) => {
    await expect(addRosterPlayerForApp('team-1', { uid: 'owner-1' } as any, {
      name: 'Sam Player',
      photoFile
    })).rejects.toThrow(/image|5MB/i);

    expect(nativeFirestoreMutationMocks.commitNativeFirestoreWrites).not.toHaveBeenCalled();
    expect(nativeStorageMocks.uploadNativePlayerPhotoFile).not.toHaveBeenCalled();
  });

  it('creates the player owner before uploading, then persists the final native photo', async () => {
    const file = new File(['photo'], 'player.jpg', { type: 'image/jpeg' });
    nativeStorageMocks.uploadNativePlayerPhotoFile.mockImplementationOnce(async () => {
      expect(nativeFirestoreMutationMocks.commitNativeFirestoreWrites).toHaveBeenCalledTimes(1);
      expect(nativeFirestoreMutationMocks.commitNativeFirestoreWrites).toHaveBeenNthCalledWith(1, [
        expect.objectContaining({
          pathSegments: ['teams', 'team-1', 'players', 'native-player-1'],
          createOnly: true,
          data: expect.objectContaining({ name: 'Sam Player', photoUrl: null })
        }),
        expect.objectContaining({
          pathSegments: ['teams', 'team-1', 'players', 'native-player-1', 'private', 'profile'],
          data: expect.objectContaining({ photoPath: null })
        })
      ]);
      return {
        url: 'https://primary.example/player.jpg',
        path: 'profile-photos/teams/team-1/players/native-player-1/player.jpg'
      };
    });

    const result = await addRosterPlayerForApp('team-1', { uid: 'owner-1' } as any, {
      name: 'Sam Player',
      photoFile: file
    });

    expect(result.playerId).toBe('native-player-1');
    expect(nativeStorageMocks.uploadNativePlayerPhotoFile).toHaveBeenCalledWith(file, 'team-1', 'native-player-1');
    expect(nativeFirestoreMutationMocks.commitNativeFirestoreWrites).toHaveBeenNthCalledWith(2, [
      expect.objectContaining({
        pathSegments: ['teams', 'team-1', 'players', 'native-player-1'],
        data: expect.objectContaining({ photoUrl: 'https://primary.example/player.jpg' })
      }),
      expect.objectContaining({
        pathSegments: ['teams', 'team-1', 'players', 'native-player-1', 'private', 'profile'],
        data: expect.objectContaining({ photoPath: 'profile-photos/teams/team-1/players/native-player-1/player.jpg' })
      })
    ]);
    expect(dbMocks.addPlayer).not.toHaveBeenCalled();
  });

  it('continues an ambiguous owner create only after an authoritative roster read confirms it', async () => {
    dbMocks.getPlayers
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'native-player-1', name: 'Sam Player' }]);
    nativeFirestoreMutationMocks.commitNativeFirestoreWrites
      .mockRejectedValueOnce(Object.assign(new Error('The owner save may have completed.'), { commitStateUnknown: true }))
      .mockResolvedValueOnce(undefined);
    __resetTeamDetailBaseSnapshotCacheForTests();

    await expect(addRosterPlayerForApp('team-1', { uid: 'owner-1' } as any, {
      name: 'Sam Player',
      photoFile: new File(['photo'], 'player.jpg', { type: 'image/jpeg' })
    })).resolves.toMatchObject({ playerId: 'native-player-1' });

    expect(nativeStorageMocks.uploadNativePlayerPhotoFile).toHaveBeenCalledTimes(1);
  });

  it('does not upload when an ambiguous owner create cannot be confirmed', async () => {
    dbMocks.getPlayers.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    nativeFirestoreMutationMocks.commitNativeFirestoreWrites.mockRejectedValueOnce(
      Object.assign(new Error('The owner save may have completed.'), { commitStateUnknown: true })
    );
    __resetTeamDetailBaseSnapshotCacheForTests();

    await expect(addRosterPlayerForApp('team-1', { uid: 'owner-1' } as any, {
      name: 'Sam Player',
      photoFile: new File(['photo'], 'player.jpg', { type: 'image/jpeg' })
    })).rejects.toThrow('owner save may have completed');

    expect(nativeStorageMocks.uploadNativePlayerPhotoFile).not.toHaveBeenCalled();
  });

  it('accepts an ambiguous native photo save after the private path confirms it committed', async () => {
    const newPath = 'profile-photos/teams/team-1/players/native-player-1/player.jpg';
    nativeFirestoreMutationMocks.commitNativeFirestoreWrites
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error('The save may have completed.'), { commitStateUnknown: true }));
    dbMocks.getPlayerPrivateProfile.mockResolvedValueOnce({ photoPath: newPath });

    const result = await addRosterPlayerForApp('team-1', { uid: 'owner-1' } as any, {
      name: 'Sam Player',
      photoFile: new File(['photo'], 'player.jpg', { type: 'image/jpeg' })
    });

    expect(result.playerId).toBe('native-player-1');
    expect(nativeStorageMocks.deleteNativePrimaryStorageFile).not.toHaveBeenCalledWith(newPath);
  });

  it('removes an ambiguous native roster photo after the private path proves its save did not commit', async () => {
    const newPath = 'profile-photos/teams/team-1/players/native-player-1/player.jpg';
    nativeFirestoreMutationMocks.commitNativeFirestoreWrites
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error('The save may have completed.'), { commitStateUnknown: true }));
    dbMocks.getPlayerPrivateProfile.mockResolvedValueOnce({ photoPath: null });

    await expect(addRosterPlayerForApp('team-1', { uid: 'owner-1' } as any, {
      name: 'Sam Player',
      photoFile: new File(['photo'], 'player.jpg', { type: 'image/jpeg' })
    })).resolves.toMatchObject({
      playerId: 'native-player-1',
      player: { photoUrl: null },
      photoWarning: expect.stringContaining('saving the photo reference failed')
    });

    expect(nativeStorageMocks.deleteNativePrimaryStorageFile).toHaveBeenCalledWith(newPath);
  });

  it('keeps a native roster photo when the authoritative final-save check is unavailable', async () => {
    nativeFirestoreMutationMocks.commitNativeFirestoreWrites
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error('The save may have completed.'), { commitStateUnknown: true }));
    dbMocks.getPlayerPrivateProfile.mockRejectedValueOnce(new Error('read unavailable'));

    await expect(addRosterPlayerForApp('team-1', { uid: 'owner-1' } as any, {
      name: 'Sam Player',
      photoFile: new File(['photo'], 'player.jpg', { type: 'image/jpeg' })
    })).resolves.toMatchObject({
      playerId: 'native-player-1',
      photoWarning: expect.stringContaining('saving the photo reference failed')
    });

    expect(nativeStorageMocks.deleteNativePrimaryStorageFile).not.toHaveBeenCalled();
  });
});

describe('addRosterPlayerForApp browser photo scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nativeRuntimeState.isNative = false;
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', ownerId: 'owner-1' });
    dbMocks.getPlayers.mockResolvedValue([]);
    dbMocks.getGames.mockResolvedValue([]);
    dbMocks.getConfigs.mockResolvedValue([]);
    dbMocks.getRosterFieldDefinitions.mockResolvedValue([]);
    dbMocks.uploadPlayerPhoto.mockResolvedValue({
      url: 'https://primary.example/player.jpg',
      path: 'profile-photos/teams/team-1/players/native-player-1/player.jpg'
    });
    dbMocks.applyRosterCsvImportOperations.mockResolvedValue([{ playerId: 'native-player-1' }]);
    __resetTeamDetailBaseSnapshotCacheForTests();
  });

  it.each([
    ['a non-image file', new File(['text'], 'player.txt', { type: 'text/plain' })],
    ['an empty image', new File([], 'player.jpg', { type: 'image/jpeg' })],
    ['an oversized image', new File([new Uint8Array((5 * 1024 * 1024) + 1)], 'player.jpg', { type: 'image/jpeg' })]
  ])('rejects %s before creating the browser player owner', async (_label, photoFile) => {
    await expect(addRosterPlayerForApp('team-1', { uid: 'owner-1' } as any, {
      name: 'Sam Player',
      photoFile
    })).rejects.toThrow(/image|5MB/i);

    expect(dbMocks.applyRosterCsvImportOperations).not.toHaveBeenCalled();
    expect(dbMocks.uploadPlayerPhoto).not.toHaveBeenCalled();
  });

  it('creates the browser player owner before uploading and persists that same id', async () => {
    const file = new File(['photo'], 'player.jpg', { type: 'image/jpeg' });
    dbMocks.uploadPlayerPhoto.mockImplementationOnce(async () => {
      expect(dbMocks.applyRosterCsvImportOperations).toHaveBeenCalledTimes(1);
      expect(dbMocks.applyRosterCsvImportOperations).toHaveBeenNthCalledWith(1, 'team-1', [expect.objectContaining({
        type: 'add',
        playerId: 'native-player-1',
        payload: expect.objectContaining({ photoUrl: null, photoPath: null })
      })]);
      return {
        url: 'https://primary.example/player.jpg',
        path: 'profile-photos/teams/team-1/players/native-player-1/player.jpg'
      };
    });

    const result = await addRosterPlayerForApp('team-1', { uid: 'owner-1' } as any, {
      name: 'Sam Player',
      photoFile: file
    });

    expect(dbMocks.uploadPlayerPhoto).toHaveBeenCalledWith(file, {
      returnUpload: true,
      teamId: 'team-1',
      playerId: 'native-player-1'
    });
    expect(dbMocks.applyRosterCsvImportOperations).toHaveBeenNthCalledWith(2, 'team-1', [expect.objectContaining({
      type: 'update',
      playerId: 'native-player-1',
      payload: expect.objectContaining({
        photoUrl: 'https://primary.example/player.jpg',
        photoPath: 'profile-photos/teams/team-1/players/native-player-1/player.jpg'
      })
    })]);
    expect(result.playerId).toBe('native-player-1');
  });

  it('reports a post-owner upload failure as a partial success so a retry cannot duplicate the player', async () => {
    dbMocks.uploadPlayerPhoto.mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(addRosterPlayerForApp('team-1', { uid: 'owner-1' } as any, {
      name: 'Sam Player',
      photoFile: new File(['photo'], 'player.jpg', { type: 'image/jpeg' })
    })).resolves.toMatchObject({
      playerId: 'native-player-1',
      player: { photoUrl: null, photoPath: null },
      photoWarning: 'Player was added, but the photo upload failed: storage unavailable'
    });

    expect(dbMocks.applyRosterCsvImportOperations).toHaveBeenCalledTimes(1);
  });

  it('recovers a browser photo save when an authoritative read confirms the write committed', async () => {
    const newPath = 'profile-photos/teams/team-1/players/native-player-1/player.jpg';
    dbMocks.getPlayers.mockResolvedValueOnce([]);
    dbMocks.getPlayerPrivateProfile.mockResolvedValueOnce({ photoPath: newPath });
    dbMocks.applyRosterCsvImportOperations
      .mockResolvedValueOnce([{ playerId: 'native-player-1' }])
      .mockRejectedValueOnce(Object.assign(new Error('response unavailable'), { code: 'unavailable' }));
    __resetTeamDetailBaseSnapshotCacheForTests();

    const result = await addRosterPlayerForApp('team-1', { uid: 'owner-1' } as any, {
      name: 'Sam Player',
      photoFile: new File(['photo'], 'player.jpg', { type: 'image/jpeg' })
    });

    expect(result.playerId).toBe('native-player-1');
    expect(dbMocks.deleteLegacyImageUpload).not.toHaveBeenCalledWith(newPath);
  });
});

function buildTeamDiamondGame(id: string, revision = 8) {
  const instanceId = `00000000-0000-4000-8000-${String(revision).padStart(12, '0')}`;
  const checkpointHash = `sha256:${'a'.repeat(64)}`;
  const configHash = `sha256:${'b'.repeat(64)}`;
  const projectionHash = `sha256:${'c'.repeat(64)}`;
  return {
    id,
    teamId: 'team-1',
    status: 'completed',
    seasonLabel: '2026',
    date: `2026-03-${String(revision).padStart(2, '0')}`,
    trackingEngine: 'diamond-v2',
    statTrackerConfigId: 'baseball',
    diamondProjectionStatus: 'current',
    diamondProjectionRevision: revision,
    diamondProjectionComplete: true,
    diamondScorebookInstanceId: instanceId,
    diamondProjectionCheckpointHash: checkpointHash,
    diamondStatConfigSnapshotHash: configHash,
    diamondProjectionHash: projectionHash,
    diamondPublicTeamStats: {
      trackingEngine: 'diamond-v2',
      projectionSchemaVersion: 1,
      sourceRevision: revision,
      checkpointHash,
      coverage: { batting: 'complete' },
      publicStatIds: ['r'],
      side: 'home',
      complete: true,
      stats: { r: 1 },
      observedStats: {},
      statCoverage: { r: 'complete' },
      teamId: 'team-1',
      diamondGameId: id,
      instanceId,
      diamondScorebookInstanceId: instanceId,
      projectionGeneration: instanceId,
      statConfigSnapshotHash: configHash,
      projectionHash
    },
    rulesProfileId: 'baseball-youth@1',
    homeScore: 1,
    awayScore: 0
  };
}

function buildTeamDiamondPlayerDoc(
  game: ReturnType<typeof buildTeamDiamondGame>,
  playerId = 'player-1',
  overrides: Record<string, unknown> = {}
) {
  return {
    id: playerId,
    data: () => ({
      schemaVersion: 1,
      trackingEngine: 'diamond-v2',
      projectionSchemaVersion: 1,
      playerId,
      playerName: 'Pat Star',
      playerNumber: '9',
      sourceRevision: game.diamondProjectionRevision,
      checkpointHash: game.diamondProjectionCheckpointHash,
      complete: true,
      publicStatIds: ['h'],
      stats: { h: 1 },
      observedStats: {},
      derivedStats: {},
      observedDerivedStats: {},
      statCoverage: { h: 'complete' },
      statSources: {},
      sourcePlayIds: [],
      unavailableDerivedStats: [],
      missingStatFamilies: [],
      coverage: { batting: 'complete' },
      participated: true,
      participationStatus: 'appeared',
      participationSource: 'diamond-v2',
      teamId: 'team-1',
      diamondGameId: game.id,
      instanceId: game.diamondScorebookInstanceId,
      diamondScorebookInstanceId: game.diamondScorebookInstanceId,
      projectionGeneration: game.diamondScorebookInstanceId,
      statConfigSnapshotHash: game.diamondStatConfigSnapshotHash,
      projectionHash: game.diamondProjectionHash,
      ...overrides
    })
  };
}

function teamSnapshot(...docs: ReturnType<typeof buildTeamDiamondPlayerDoc>[]) {
  return { forEach(callback: (docSnap: any) => void) { docs.forEach(callback); } };
}

function buildTeamDiamondManagerPlayerData(
  game: ReturnType<typeof buildTeamDiamondGame>,
  playerId: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    trackingEngine: 'diamond-v2',
    authoritative: true,
    complete: true,
    projectionSchemaVersion: 1,
    playerId,
    side: 'home',
    instanceId: game.diamondScorebookInstanceId,
    diamondScorebookInstanceId: game.diamondScorebookInstanceId,
    projectionGeneration: game.diamondScorebookInstanceId,
    sourceRevision: game.diamondProjectionRevision,
    checkpointHash: game.diamondProjectionCheckpointHash,
    statConfigSnapshotHash: game.diamondStatConfigSnapshotHash,
    projectionHash: game.diamondProjectionHash,
    stats: { h: 1 },
    observedStats: {},
    derivedStats: {},
    observedDerivedStats: {},
    statCoverage: { h: 'complete' },
    coverage: { batting: 'complete' },
    participated: true,
    ...overrides
  };
}

function buildTeamDiamondManagerTeamData(
  game: ReturnType<typeof buildTeamDiamondGame>,
  overrides: Record<string, unknown> = {}
) {
  return {
    trackingEngine: 'diamond-v2',
    complete: true,
    projectionSchemaVersion: 1,
    side: 'home',
    instanceId: game.diamondScorebookInstanceId,
    diamondScorebookInstanceId: game.diamondScorebookInstanceId,
    projectionGeneration: game.diamondScorebookInstanceId,
    sourceRevision: game.diamondProjectionRevision,
    checkpointHash: game.diamondProjectionCheckpointHash,
    statConfigSnapshotHash: game.diamondStatConfigSnapshotHash,
    projectionHash: game.diamondProjectionHash,
    stats: { r: 1 },
    observedStats: {},
    statCoverage: { r: 'complete' },
    coverage: { batting: 'complete' },
    inningLines: {},
    ...overrides
  };
}

function prepareBoundedDiamondManagerSeason(
  gameCount: number,
  playerCount: number,
  projectedPlayerCount = playerCount
) {
  __resetTeamDetailBaseSnapshotCacheForTests();
  seasonRecordMocks.listSeasonLabels.mockReturnValue(['2026']);
  dbMocks.getTeam.mockResolvedValue({ id: 'team-1', ownerId: 'owner-1', sport: 'Baseball' });
  const players = Array.from({ length: playerCount }, (_, index) => ({
    id: `player-${String(index + 1).padStart(2, '0')}`,
    name: `Player ${String(index + 1)}`,
    number: String(index + 1),
    active: true
  }));
  const games = Array.from({ length: gameCount }, (_, index) => ({
    ...buildTeamDiamondGame(`game-${String(index + 1).padStart(2, '0')}`, index + 1),
    date: new Date(Date.UTC(2026, 0, index + 1)).toISOString()
  }));
  const config = {
    id: 'baseball',
    baseType: 'Baseball',
    statDefinitions: [
      { id: 'h', label: 'Hits', scope: 'player', visibility: 'public' },
      { id: 'pitches', label: 'Pitches', scope: 'player', visibility: 'private' }
    ]
  };
  dbMocks.getPlayers.mockResolvedValue(players);
  dbMocks.getGames.mockResolvedValue(games);
  dbMocks.getConfigs.mockResolvedValue([config]);
  vi.mocked(selectAnalyticsConfig).mockReturnValue(config as any);
  firebaseMocks.collection.mockImplementation((_db: unknown, path: string) => path);
  firebaseMocks.getDocs.mockImplementation(async (path: string) => {
    const game = games.find((candidate) => path.includes(`/games/${candidate.id}/`));
    if (!game) throw new Error(`Unexpected Diamond public stat path: ${path}`);
    return teamSnapshot(...players.slice(0, projectedPlayerCount).map((player) => buildTeamDiamondPlayerDoc(
      game,
      player.id,
      { playerName: player.name, playerNumber: player.number }
    )));
  });
  return { config, games, players };
}

function buildBoundedDiamondManagerResult(
  requestedGames: ReturnType<typeof buildTeamDiamondGame>[],
  playerIds: string[],
  {
    includeTeamDocuments = true,
    malformedTeamDocuments = false,
    teamStatValue = 1,
    privateStatValue = 9,
    documentPlayerIds = playerIds
  }: {
    includeTeamDocuments?: boolean;
    malformedTeamDocuments?: boolean;
    teamStatValue?: number;
    privateStatValue?: number;
    documentPlayerIds?: string[];
  } = {}
) {
  return {
    status: 'complete' as const,
    reason: null,
    documentsByGameId: new Map(requestedGames.map((game) => [game.id, documentPlayerIds.map((playerId) => ({
      id: playerId,
      data: buildTeamDiamondManagerPlayerData(game, playerId, {
        stats: { h: privateStatValue, pitches: privateStatValue },
        statCoverage: { h: 'complete', pitches: 'complete' }
      })
    }))])),
    teamDocumentsByGameId: new Map(includeTeamDocuments
      ? requestedGames.map((game) => [
          game.id,
          malformedTeamDocuments ? {} : buildTeamDiamondManagerTeamData(game, { stats: { r: teamStatValue } })
        ])
      : [])
  };
}

describe('Team Insights manager-stat production fan-out', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasFullTeamAccess).mockImplementation((user: any, team: any) => user?.uid === team?.ownerId);
  });

  it('runs the grouped season and all-season overlap with exactly three active chunks', async () => {
    const { config, games, players } = prepareBoundedDiamondManagerSeason(120, 25);
    (config.statDefinitions.find(({ id }) => id === 'h') as any).topStat = true;
    games.forEach((game, index) => {
      game.seasonLabel = `season-${Math.floor(index / 40) + 1}`;
    });
    seasonRecordMocks.listSeasonLabels.mockReturnValue(['season-3', 'season-2', 'season-1']);
    const firstWave: string[] = [];
    let active = 0;
    let peakActive = 0;
    let releaseFirstWave!: () => void;
    const firstWaveBarrier = new Promise<void>((resolve) => {
      releaseFirstWave = resolve;
    });
    diamondManagerStatsMocks.loadDiamondManagerStats.mockImplementation(async ({ games: requestedGames, playerIds }: any) => {
      active += 1;
      peakActive = Math.max(peakActive, active);
      if (firstWave.length < 3) {
        firstWave.push(requestedGames.map((game: any) => game.id).join(','));
        if (firstWave.length === 3) releaseFirstWave();
        await firstWaveBarrier;
      }
      active -= 1;
      return buildBoundedDiamondManagerResult(requestedGames, playerIds);
    });

    const insights = await loadTeamDetailInsights('team-1', { uid: 'owner-1' } as any);

    const calls = diamondManagerStatsMocks.loadDiamondManagerStats.mock.calls.map(([request]: any[]) => request);
    expect(calls).toHaveLength(6);
    expect(peakActive).toBe(3);
    expect(new Set(firstWave).size).toBe(2);
    expect(calls.reduce((total: number, request: any) => (
      total + request.games.length * (request.playerIds.length + 1)
    ), 0)).toBe(6_240);
    expect(calls.reduce((total: number, request: any) => total + 2 + request.games.length, 0)).toBe(252);
    expect(calls.every((request: any) => request.playerIds.length === players.length)).toBe(true);
    expect(insights.rosterStatistics.unavailableSeasons).toEqual([]);
    expect(insights.rosterStatistics.seasons).toHaveLength(3);
    expect(insights.rosterStatistics.seasons.every((season) => (
      season.diamond?.privateStatsStatus === 'complete'
      && season.diamond?.statVisibility === 'manager-internal'
    ))).toBe(true);
    expect(vi.mocked(buildPlayerLeaderboardSnapshot).mock.calls.some(([input]: any[]) => (
      input?.seasonStatsByPlayerId?.['player-01']?.h === 1_080
    ))).toBe(true);
  });

  it('binds the 100-player, 120-label late-chunk recovery envelope to 984 calls', async () => {
    const { config, games, players } = prepareBoundedDiamondManagerSeason(120, 100, 50);
    const projectedPlayerIds = new Set(players.slice(0, 50).map(({ id }) => id));
    (config.statDefinitions.find(({ id }) => id === 'h') as any).topStat = true;
    const labels = games.map((game, index) => {
      const label = `fragment-${String(index + 1).padStart(3, '0')}`;
      game.seasonLabel = label;
      return label;
    });
    seasonRecordMocks.listSeasonLabels.mockReturnValue([...labels].reverse());
    const signatureCalls = new Map<string, number>();
    let active = 0;
    let peakActive = 0;
    diamondManagerStatsMocks.loadDiamondManagerStats.mockImplementation(async ({ games: requestedGames, playerIds }: any) => {
      active += 1;
      peakActive = Math.max(peakActive, active);
      await Promise.resolve();
      const signature = requestedGames.map((game: any) => game.id).join(',');
      const signatureCall = (signatureCalls.get(signature) || 0) + 1;
      signatureCalls.set(signature, signatureCall);
      active -= 1;
      const isFirstSeasonAttempt = requestedGames.length === 1 && signatureCall === 4;
      const isFirstAggregateLastChunk = requestedGames.length === 40
        && requestedGames[0]?.id === games[80]?.id
        && signatureCall === 4;
      if (isFirstSeasonAttempt || isFirstAggregateLastChunk) {
        return {
          status: 'unavailable' as const,
          reason: 'forced-bounded-recovery',
          documentsByGameId: new Map(),
          teamDocumentsByGameId: new Map()
        };
      }
      return buildBoundedDiamondManagerResult(requestedGames, playerIds, {
        documentPlayerIds: playerIds.filter((playerId: string) => projectedPlayerIds.has(playerId))
      });
    });

    const insights = await loadTeamDetailInsights('team-1', { uid: 'owner-1' } as any);

    const calls = diamondManagerStatsMocks.loadDiamondManagerStats.mock.calls.map(([request]: any[]) => request);
    expect(calls).toHaveLength(984);
    expect(peakActive).toBeLessThanOrEqual(3);
    expect(calls.reduce((total: number, request: any) => (
      total + request.games.length * (request.playerIds.length + 1)
    ), 0)).toBe(49_920);
    expect(calls.reduce((total: number, request: any) => total + 2 + request.games.length, 0)).toBe(3_888);
    expect(calls.filter((request: any) => request.games.length === 1)).toHaveLength(960);
    expect(calls.filter((request: any) => request.games.length === 40)).toHaveLength(24);
    expect(insights.rosterStatistics.unavailableSeasons).toEqual([]);
    expect(insights.rosterStatistics.seasons).toHaveLength(120);
    expect(insights.rosterStatistics.seasons.every((season) => (
      season.diamond?.privateStatsStatus === 'complete'
      && season.diamond?.statVisibility === 'manager-internal'
    ))).toBe(true);
    expect(vi.mocked(buildPlayerLeaderboardSnapshot).mock.calls.some(([input]: any[]) => (
      input?.seasonStatsByPlayerId?.['player-01']?.h === 1_080
    ))).toBe(true);
  });

  it('keeps a rate-limited manager result non-authoritative and reloadable', async () => {
    const { games } = prepareBoundedDiamondManagerSeason(1, 1);
    let rateLimited = true;
    diamondManagerStatsMocks.loadDiamondManagerStats.mockImplementation(async ({ games: requestedGames, playerIds }: any) => (
      rateLimited
        ? {
            status: 'unavailable' as const,
            reason: 'manager-stat-admission-limited',
            documentsByGameId: new Map(),
            teamDocumentsByGameId: new Map()
          }
        : buildBoundedDiamondManagerResult(requestedGames, playerIds)
    ));

    const limited = await loadTeamDetailInsights('team-1', { uid: 'owner-1' } as any);
    const limitedCalls = diamondManagerStatsMocks.loadDiamondManagerStats.mock.calls.length;
    const limitedSeason = limited.rosterStatistics.seasons[0];

    expect(limitedCalls).toBe(2);
    expect(limited.rosterStatistics.unavailableSeasons).toEqual([]);
    expect(limitedSeason.rows[0].values.h.value).toBe(1);
    expect(limitedSeason.rows[0].values).not.toHaveProperty('pitches');
    expect(limitedSeason.diamond).toMatchObject({
      requestedStatVisibility: 'manager-internal',
      statVisibility: 'public',
      privateStatsStatus: 'unavailable',
      privateStatsReason: 'manager-season-chunk-1:manager-stat-admission-limited'
    });

    rateLimited = false;
    const recovered = await loadTeamDetailInsights('team-1', { uid: 'owner-1' } as any);
    const recoveredSeason = recovered.rosterStatistics.seasons[0];

    expect(diamondManagerStatsMocks.loadDiamondManagerStats.mock.calls).toHaveLength(limitedCalls + 1);
    expect(diamondManagerStatsMocks.loadDiamondManagerStats.mock.calls.slice(limitedCalls).every(([request]: any[]) => (
      request.games.length === games.length
    ))).toBe(true);
    expect(recoveredSeason.rows[0].values.pitches.value).toBe(9);
    expect(recoveredSeason.diamond).toMatchObject({
      statVisibility: 'manager-internal',
      privateStatsStatus: 'complete'
    });
  });
});

describe('team detail bootstrap loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasFullTeamAccess).mockImplementation((user: any, team: any) => user?.uid === team?.ownerId);
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', ownerId: 'owner-1', name: 'Bears', sport: 'Basketball' });
    dbMocks.getPlayersWithPrivateRosterContacts.mockImplementation((_teamId: string, options: any = {}) => (
      Array.isArray(options.players) ? options.players : dbMocks.getPlayers(_teamId, options)
    ));
    dbMocks.getPlayers.mockResolvedValue([{ id: 'player-1', name: 'Pat Star', active: true }]);
    dbMocks.getGames.mockResolvedValue([{ id: 'game-1', type: 'game', status: 'scheduled' }]);
    dbMocks.getConfigs.mockResolvedValue([{ id: 'config-1', name: 'Config' }]);
    scheduleServiceMocks.loadTeamOverviewSchedule.mockResolvedValue(null);
    __resetTeamDetailBaseSnapshotCacheForTests();
  });

  it('skips games and stat config reads for the lightweight bootstrap path', async () => {
    const model = await loadParentTeamDetailBootstrap('team-1', { uid: 'parent-1' } as any);

    expect(model.team.name).toBe('Bears');
    expect(model.players).toHaveLength(1);
    expect(model.upcomingEvents).toEqual([]);
    expect(model.statTrackerConfigs).toEqual([]);
    expect(dbMocks.getTeam).toHaveBeenCalledTimes(1);
    expect(dbMocks.getPlayers).toHaveBeenCalledTimes(1);
    expect(dbMocks.getGames).not.toHaveBeenCalled();
    expect(dbMocks.getConfigs).not.toHaveBeenCalled();
  });

  it('uses the bounded overview schedule during bootstrap without hydrating games', async () => {
    scheduleServiceMocks.loadTeamOverviewSchedule.mockResolvedValueOnce([{
      eventKey: 'team-1::calendar-practice::staff-team-team-1',
      id: 'calendar-practice',
      teamId: 'team-1',
      teamName: 'Bears',
      type: 'practice',
      title: 'Bears Practice',
      date: new Date(Date.now() + 24 * 60 * 60 * 1000),
      isDbGame: false,
      isCancelled: false,
      assignments: [],
      openAssignmentCount: 0
    }]);

    const model = await loadParentTeamDetailBootstrap('team-1', { uid: 'parent-1' } as any);

    expect(model.upcomingEvents).toEqual([expect.objectContaining({ id: 'calendar-practice' })]);
    expect(scheduleServiceMocks.loadTeamOverviewSchedule).toHaveBeenCalledWith(
      'team-1',
      'Bears',
      expect.objectContaining({ uid: 'parent-1' })
    );
    expect(dbMocks.getGames).not.toHaveBeenCalled();
    expect(dbMocks.getConfigs).not.toHaveBeenCalled();
  });

  it('recovers management access from REST and refreshes the auth token only after a 401', async () => {
    const previousFetch = globalThis.fetch;
    dbMocks.getTeam.mockResolvedValueOnce({
      id: 'team-1',
      name: 'Bears',
      sport: 'Basketball',
      isPublic: true,
      active: true
    });
    authServiceMocks.getNativeAuthIdToken
      .mockResolvedValueOnce('cached-web-token')
      .mockResolvedValueOnce('refreshed-web-token');
    dbMocks.getRosterFieldDefinitions.mockResolvedValueOnce([]);
    dbMocks.applyRosterCsvImportOperations.mockResolvedValueOnce([{ playerId: 'player-2' }]);
    (globalThis as any).fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'Expired token' } })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: 'projects/test-project/databases/(default)/documents/teams/team-1',
          fields: {
            name: { stringValue: 'Bears' },
            sport: { stringValue: 'Basketball' },
            ownerId: { stringValue: 'owner-1' },
            active: { booleanValue: true }
          }
        })
      } as Response);

    try {
      const model = await loadParentTeamDetailBootstrap('team-1', { uid: 'owner-1', roles: ['coach'] } as any);

      expect(model.canManageTeam).toBe(true);
      expect(model.team.ownerId).toBe('owner-1');
      expect(dbMocks.getPlayersWithPrivateRosterContacts).toHaveBeenCalledWith('team-1', expect.objectContaining({
        includeInactive: true
      }));
      expect(authServiceMocks.getNativeAuthIdToken.mock.calls).toEqual([[false], [true]]);

      await expect(addRosterPlayerForApp('team-1', { uid: 'owner-1', roles: ['coach'] } as any, {
        name: 'New Player'
      })).resolves.toMatchObject({ playerId: 'player-2' });
      expect(dbMocks.getTeam).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('grants fresh-session management from the authenticated callable projection without browser REST', async () => {
    const previousFetch = globalThis.fetch;
    const fetchMock = vi.fn();
    (globalThis as any).fetch = fetchMock;
    dbMocks.getTeam.mockResolvedValueOnce({
      id: 'team-1',
      name: 'Bears',
      sport: 'Basketball',
      ownerId: 'owner-1',
      adminEmails: [],
      active: true,
      zip: '66210',
      leagueUrl: 'https://league.example.test/bears',
      bracketUrl: 'https://bracket.example.test/bears',
      livestreamUrl: 'https://stream.example.test/bears',
      scheduleNotifications: { enabled: true }
    });

    try {
      const model = await loadParentTeamDetailBootstrap('team-1', { uid: 'owner-1' } as any);

      expect(model.canManageTeam).toBe(true);
      expect(model.team.ownerId).toBe('owner-1');
      expect(model.team.zip).toBe('66210');
      expect(model.team.leagueUrl).toBe('https://league.example.test/bears');
      expect(model.team.bracketUrl).toBe('https://bracket.example.test/bears');
      expect(model.team.streamUrl).toBe('https://stream.example.test/bears');
      expect(model.team.scheduleNotifications).toMatchObject({ enabled: true });
      expect(dbMocks.getPlayersWithPrivateRosterContacts).toHaveBeenCalledWith('team-1', expect.objectContaining({
        includeInactive: true
      }));
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('includes later-page players when the native roster fallback is paginated', async () => {
    const previousFetch = globalThis.fetch;
    nativeRuntimeState.isNative = true;
    dbMocks.getPlayers.mockRejectedValueOnce(new Error('SDK roster unavailable'));
    authServiceMocks.getNativeAuthIdToken.mockResolvedValue('native-token');
    (globalThis as any).fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          documents: [{
            name: 'projects/test-project/databases/(default)/documents/teams/team-1/players/player-1',
            fields: { name: { stringValue: 'First Player' }, active: { booleanValue: true } }
          }],
          nextPageToken: 'next page+/='
        })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          documents: [{
            name: 'projects/test-project/databases/(default)/documents/teams/team-1/players/player-2',
            fields: { name: { stringValue: 'Later Player' }, active: { booleanValue: true } }
          }]
        })
      } as Response);

    try {
      const model = await loadParentTeamDetailBootstrap('team-1', { uid: 'parent-1' } as any);

      expect(model.players.map((player) => player.id)).toEqual(['player-1', 'player-2']);
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
      expect(String(vi.mocked(globalThis.fetch).mock.calls[1][0]))
        .toContain('pageToken=next+page%2B%2F%3D');
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('loads games and stat configs once a deferred detail surface requests them', async () => {
    await loadParentTeamDetailBootstrap('team-1', { uid: 'parent-1' } as any);
    await loadParentTeamDetail('team-1', { uid: 'parent-1' } as any, { includeDeferredData: false });

    expect(dbMocks.getTeam).toHaveBeenCalledTimes(1);
    expect(dbMocks.getPlayers).toHaveBeenCalledTimes(1);
    expect(dbMocks.getGames).toHaveBeenCalledTimes(1);
    expect(dbMocks.getConfigs).toHaveBeenCalledTimes(1);
  });

  it('includes imported calendar events in the team overview schedule', async () => {
    const importedPractice = {
      eventKey: 'team-1::calendar-practice::staff-team-team-1',
      id: 'calendar-practice',
      teamId: 'team-1',
      teamName: 'Bears',
      type: 'practice',
      title: 'Bears Practice',
      date: new Date(Date.now() + 24 * 60 * 60 * 1000),
      location: 'Scheels Overland Park Soccer Complex',
      locationDetail: 'Field 7 NE',
      opponent: null,
      childId: 'staff-team-team-1',
      childName: 'Bears',
      isDbGame: false,
      isCancelled: false,
      sourceLabel: 'Imported calendar',
      assignments: [],
      openAssignmentCount: 0
    };
    dbMocks.getGames.mockResolvedValueOnce([]);
    scheduleServiceMocks.loadTeamOverviewSchedule.mockResolvedValueOnce([importedPractice]);

    const model = await loadParentTeamDetail('team-1', { uid: 'owner-1' } as any, { includeDeferredData: false });

    expect(scheduleServiceMocks.loadTeamOverviewSchedule).toHaveBeenCalledWith('team-1', 'Bears', expect.objectContaining({ uid: 'owner-1' }));
    expect(model.upcomingEvents).toHaveLength(1);
    expect(model.nextEvent).toMatchObject({
      id: 'calendar-practice',
      title: 'Bears Practice',
      location: 'Scheels Overland Park Soccer Complex',
      locationDetail: 'Field 7 NE',
      isDbGame: false,
      sourceLabel: 'Imported calendar'
    });
  });

  it('preserves completed database games outside the imported calendar history window', async () => {
    const historicalGame = {
      id: 'historical-game',
      type: 'game',
      title: 'Bears vs. Alumni',
      date: new Date('2020-01-15T18:00:00Z'),
      location: 'Old Gym',
      opponent: 'Alumni',
      status: 'completed',
      homeScore: 42,
      awayScore: 40
    };
    dbMocks.getGames.mockResolvedValueOnce([historicalGame]);
    scheduleServiceMocks.loadTeamOverviewSchedule.mockResolvedValueOnce([]);

    const model = await loadParentTeamDetail('team-1', { uid: 'owner-1' } as any, { includeDeferredData: false });

    expect(model.recentResults).toEqual([
      expect.objectContaining({
        id: 'historical-game',
        title: 'Bears vs. Alumni',
        isDbGame: true
      })
    ]);
  });

  it('keeps cancelled imported calendar events out of the team overview', () => {
    const built = buildTeamDetailModel({
      teamId: 'team-1',
      team: { id: 'team-1', ownerId: 'owner-1', name: 'Bears' },
      scheduleEvents: [{
        eventKey: 'team-1::cancelled-practice::staff-team-team-1',
        id: 'cancelled-practice',
        teamId: 'team-1',
        teamName: 'Bears',
        type: 'practice',
        title: 'Cancelled Practice',
        date: new Date('2100-06-01T18:00:00Z'),
        location: 'Fieldhouse',
        opponent: null,
        childId: 'staff-team-team-1',
        childName: 'Bears',
        isDbGame: false,
        isCancelled: true,
        assignments: [],
        openAssignmentCount: 0
      }]
    });

    expect(built.upcomingEvents).toEqual([]);
  });

  it('overlays database metadata onto matching calendar projections', () => {
    const built = buildTeamDetailModel({
      teamId: 'team-1',
      team: { id: 'team-1', ownerId: 'owner-1', name: 'Bears' },
      configs: [{ id: 'config-1', name: 'Varsity', baseType: 'Basketball' }],
      games: [{
        id: 'game-1',
        type: 'game',
        date: new Date('2100-06-01T18:00:00Z'),
        opponent: 'Falcons',
        statTrackerConfigId: 'config-1',
        locationDetail: 'Court 2',
        isPrivate: true,
        isPublic: false,
        shareable: false,
        publicCalendar: false
      }],
      scheduleEvents: [{
        eventKey: 'team-1::game-1::staff-team-team-1',
        id: 'game-1',
        teamId: 'team-1',
        teamName: 'Bears',
        type: 'game',
        title: 'vs. Falcons',
        date: new Date('2100-06-01T18:00:00Z'),
        location: 'Main Gym',
        locationDetail: null,
        opponent: 'Falcons',
        statTrackerConfigId: null,
        childId: 'staff-team-team-1',
        childName: 'Bears',
        isDbGame: true,
        isCancelled: false,
        assignments: [],
        openAssignmentCount: 0
      }]
    });

    expect(built.upcomingEvents).toEqual([
      expect.objectContaining({
        id: 'game-1',
        statTrackerConfigId: 'config-1',
        statTrackerConfigLabel: 'Varsity',
        statTrackerConfigExists: true,
        locationDetail: 'Court 2',
        isPrivate: true,
        isPublic: false,
        shareable: false,
        publicCalendar: false
      })
    ]);
  });

  it('replaces recurring practice masters with their expanded schedule occurrences', () => {
    const built = buildTeamDetailModel({
      teamId: 'team-1',
      team: { id: 'team-1', ownerId: 'owner-1', name: 'Bears' },
      games: [{
        id: 'practice-master',
        type: 'practice',
        title: 'Weekly Practice',
        date: new Date('2100-06-01T18:00:00Z'),
        recurring: true
      }],
      scheduleEvents: [{
        eventKey: 'team-1::practice-master__2100-06-08::staff-team-team-1',
        id: 'practice-master__2100-06-08',
        teamId: 'team-1',
        teamName: 'Bears',
        type: 'practice',
        title: 'Weekly Practice',
        date: new Date('2100-06-08T18:00:00Z'),
        location: 'Practice Field',
        opponent: null,
        childId: 'staff-team-team-1',
        childName: 'Bears',
        isDbGame: true,
        isCancelled: false,
        assignments: [],
        openAssignmentCount: 0
      }]
    });

    expect(built.upcomingEvents.map((event) => event.id)).toEqual(['practice-master__2100-06-08']);
  });

  it('falls back to database events when the optional calendar load exceeds its deadline', async () => {
    vi.useFakeTimers();
    try {
      dbMocks.getGames.mockResolvedValueOnce([{
        id: 'game-1',
        type: 'game',
        title: 'vs. Falcons',
        date: new Date('2100-06-01T18:00:00Z'),
        opponent: 'Falcons'
      }]);
      scheduleServiceMocks.loadTeamOverviewSchedule.mockReturnValueOnce(new Promise(() => {}));

      const modelPromise = loadParentTeamDetail('team-1', { uid: 'owner-1' } as any, { includeDeferredData: false });
      await vi.advanceTimersByTimeAsync(1500);

      await expect(modelPromise).resolves.toMatchObject({
        upcomingEvents: [expect.objectContaining({ id: 'game-1', isDbGame: true })]
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps deferred insights aligned to the current header season without final scores', async () => {
    seasonRecordMocks.listSeasonLabels.mockReturnValue(['2026', '2025']);
    dbMocks.getGames.mockResolvedValue([
      { id: 'current', type: 'game', status: 'scheduled', seasonLabel: '2026', date: '2026-03-01T18:00:00Z' },
      { id: 'older', type: 'game', status: 'completed', seasonLabel: '2025', date: '2025-10-01T18:00:00Z', homeScore: 5, awayScore: 0 }
    ]);

    const insights = await loadTeamDetailInsights('team-1', { uid: 'parent-1' } as any);

    expect(insights.teamAnalytics.seasonLabel).toBe('2026');
    expect(insights.teamAnalytics.completedGameCount).toBe(0);
    expect(insights.teamAnalytics.availableSeasons).toEqual(['2026', '2025']);
  });

  it('keeps leaderboards aggregated across all completed games while roster statistics stay season scoped', async () => {
    __resetTeamDetailBaseSnapshotCacheForTests();
    seasonRecordMocks.listSeasonLabels.mockReturnValue(['2026', '2025']);
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', sport: 'Basketball' });
    dbMocks.getPlayers.mockResolvedValue([
      { id: 'player-1', name: 'Pat Star', number: '9', active: true },
      { id: 'player-2', name: 'Sam Bench', number: '12', active: true }
    ]);
    dbMocks.getGames.mockResolvedValue([
      { id: 'current-game', status: 'completed', seasonLabel: '2026', date: '2026-03-01', homeScore: 1, awayScore: 0 },
      { id: 'old-game', status: 'completed', seasonLabel: '2025', date: '2025-03-01', homeScore: 1, awayScore: 0 }
    ]);
    const config = { id: 'config-1', columns: ['PTS'], statDefinitions: [{ id: 'pts', label: 'PTS', scope: 'player', visibility: 'public' }] };
    dbMocks.getConfigs.mockResolvedValue([config]);
    vi.mocked(selectAnalyticsConfig).mockReturnValueOnce(config as any).mockReturnValueOnce(config as any);
    dbMocks.getAggregatedStatsForGames.mockImplementation(async (_teamId: string, gameIds: string[]) => {
      if (gameIds.length === 2) return { 'player-1': { pts: 16 } };
      return gameIds.includes('current-game') ? { 'player-1': { pts: 12 } } : { 'player-1': { pts: 4 } };
    });

    const insights = await loadTeamDetailInsights('team-1', { uid: 'parent-1' } as any);

    expect(insights.rosterStatistics.seasons.map((season) => season.rows.map((row) => row.values.pts.value))).toEqual([[12, 0], [4, 0]]);
    expect(buildPlayerLeaderboardSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      seasonStatsByPlayerId: { 'player-1': { pts: 16 } }
    }));
    expect(dbMocks.getAggregatedStatsForGames).toHaveBeenCalledWith('team-1', ['current-game', 'old-game']);
    expect(dbMocks.getAggregatedStatsForGames).toHaveBeenCalledWith('team-1', ['current-game']);
    expect(dbMocks.getAggregatedStatsForGames).toHaveBeenCalledWith('team-1', ['old-game']);
  });

  it('retries one partial-empty Diamond public season load and recovers on the second bounded attempt', async () => {
    const game = buildTeamDiamondGame('diamond-game-1');
    const config = { id: 'baseball', baseType: 'Baseball', statDefinitions: [
      { id: 'h', label: 'Hits', scope: 'player', visibility: 'public' },
      { id: 'r', label: 'Runs', scope: 'team', visibility: 'public' }
    ] };
    seasonRecordMocks.listSeasonLabels.mockReturnValue(['2026']);
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', sport: 'Baseball' });
    dbMocks.getGames.mockResolvedValue([game]);
    dbMocks.getConfigs.mockResolvedValue([config]);
    vi.mocked(selectAnalyticsConfig).mockReturnValue(config as any);
    firebaseMocks.collection.mockImplementation((_db: unknown, path: string) => path);
    firebaseMocks.getDocs
      .mockRejectedValueOnce(new Error('temporary rules propagation'))
      .mockResolvedValueOnce(teamSnapshot(buildTeamDiamondPlayerDoc(game)));

    const insights = await loadTeamDetailInsights('team-1', { uid: 'parent-1' } as any);
    const season = insights.rosterStatistics.seasons[0];

    expect(firebaseMocks.getDocs).toHaveBeenCalledTimes(2);
    expect(insights.rosterStatistics.unavailableSeasons).toEqual([]);
    expect(season.rows[0].values.h).toMatchObject({ value: 1, status: 'complete' });
    expect(season.diamond).toMatchObject({ pending: false, publicStatsStatus: 'complete' });
  });

  it('marks a repeatedly partial-empty Diamond season unavailable after one retry', async () => {
    const game = buildTeamDiamondGame('diamond-game-1');
    const config = { id: 'baseball', baseType: 'Baseball', statDefinitions: [
      { id: 'h', label: 'Hits', scope: 'player', visibility: 'public' },
      { id: 'r', label: 'Runs', scope: 'team', visibility: 'public' }
    ] };
    seasonRecordMocks.listSeasonLabels.mockReturnValue(['2026']);
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', sport: 'Baseball' });
    dbMocks.getGames.mockResolvedValue([game]);
    dbMocks.getConfigs.mockResolvedValue([config]);
    vi.mocked(selectAnalyticsConfig).mockReturnValue(config as any);
    firebaseMocks.collection.mockImplementation((_db: unknown, path: string) => path);
    firebaseMocks.getDocs.mockRejectedValue(new Error('rules denied'));

    const insights = await loadTeamDetailInsights('team-1', { uid: 'parent-1' } as any);

    expect(firebaseMocks.getDocs).toHaveBeenCalledTimes(2);
    expect(insights.rosterStatistics.unavailableSeasons).toEqual(['2026']);
    expect(insights.rosterStatistics.seasons[0].rows).toEqual([]);

    firebaseMocks.getDocs.mockResolvedValue(teamSnapshot(buildTeamDiamondPlayerDoc(game)));
    const recovered = await loadTeamDetailInsights('team-1', { uid: 'parent-1' } as any);
    expect(firebaseMocks.getDocs).toHaveBeenCalledTimes(3);
    expect(recovered.rosterStatistics.unavailableSeasons).toEqual([]);
    expect(recovered.rosterStatistics.seasons[0].rows[0].values.h.value).toBe(1);
  });

  it('treats a complete-empty Diamond player collection as authoritative without retrying', async () => {
    const game = buildTeamDiamondGame('diamond-game-1');
    const config = { id: 'baseball', baseType: 'Baseball', statDefinitions: [
      { id: 'h', label: 'Hits', scope: 'player', visibility: 'public' },
      { id: 'r', label: 'Runs', scope: 'team', visibility: 'public' }
    ] };
    seasonRecordMocks.listSeasonLabels.mockReturnValue(['2026']);
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', sport: 'Baseball' });
    dbMocks.getGames.mockResolvedValue([game]);
    dbMocks.getConfigs.mockResolvedValue([config]);
    vi.mocked(selectAnalyticsConfig).mockReturnValue(config as any);
    firebaseMocks.collection.mockImplementation((_db: unknown, path: string) => path);
    firebaseMocks.getDocs.mockResolvedValue(teamSnapshot());

    const insights = await loadTeamDetailInsights('team-1', { uid: 'parent-1' } as any);
    const season = insights.rosterStatistics.seasons[0];

    expect(firebaseMocks.getDocs).toHaveBeenCalledTimes(1);
    expect(insights.rosterStatistics.unavailableSeasons).toEqual([]);
    expect(season.diamond).toMatchObject({ hasDiamond: true, pending: false, publicStatsStatus: 'complete' });
    expect(season.rows[0].values.h).toMatchObject({ value: null, status: 'not_collected' });
  });

  it('includes a projected-only Diamond participant with a safe game-time identity in public season rows', async () => {
    const game = buildTeamDiamondGame('diamond-game-1');
    const config = { id: 'baseball', baseType: 'Baseball', statDefinitions: [
      { id: 'h', label: 'Hits', scope: 'player', visibility: 'public' },
      { id: 'r', label: 'Runs', scope: 'team', visibility: 'public' }
    ] };
    seasonRecordMocks.listSeasonLabels.mockReturnValue(['2026']);
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', sport: 'Baseball' });
    dbMocks.getPlayers.mockResolvedValue([]);
    dbMocks.getGames.mockResolvedValue([game]);
    dbMocks.getConfigs.mockResolvedValue([config]);
    vi.mocked(selectAnalyticsConfig).mockReturnValue(config as any);
    firebaseMocks.collection.mockImplementation((_db: unknown, path: string) => path);
    firebaseMocks.getDocs.mockResolvedValue(teamSnapshot(buildTeamDiamondPlayerDoc(
      game,
      'manual:guest-1',
      { playerName: 'Recorded\u202e Guest', playerNumber: ' 44\u0000 ' }
    )));

    const insights = await loadTeamDetailInsights('team-1', { uid: 'parent-1' } as any);
    const season = insights.rosterStatistics.seasons[0];

    expect(season.rows).toEqual([
      expect.objectContaining({
        playerId: 'manual:guest-1',
        playerName: 'Recorded Guest',
        playerNumber: '44',
        canOpenProfile: false
      })
    ]);
    expect(season.rows[0].values.h).toMatchObject({ value: 1, status: 'complete' });
  });

  it('keeps roster order, uses the latest safe recorded identity, and sorts projected-only season participants', async () => {
    const earlierGame = buildTeamDiamondGame('diamond-game-a', 8);
    const laterGame = buildTeamDiamondGame('diamond-game-b', 9);
    const config = { id: 'baseball', baseType: 'Baseball', statDefinitions: [
      { id: 'h', label: 'Hits', scope: 'player', visibility: 'public', topStat: true },
      { id: 'r', label: 'Runs', scope: 'team', visibility: 'public' }
    ] };
    seasonRecordMocks.listSeasonLabels.mockReturnValue(['2026']);
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', sport: 'Baseball' });
    dbMocks.getPlayers.mockResolvedValue([{
      id: 'player-1',
      name: 'Renamed Current Player',
      number: '99',
      photoUrl: 'https://example.com/player.jpg',
      active: true
    }]);
    dbMocks.getGames.mockResolvedValue([laterGame, earlierGame]);
    dbMocks.getConfigs.mockResolvedValue([config]);
    vi.mocked(selectAnalyticsConfig).mockImplementation((candidateConfigs: any[]) => candidateConfigs[0] || null);
    vi.mocked(buildPlayerLeaderboardSnapshot).mockImplementation(({ players: eligiblePlayers }: any) => ({
      topStats: [{
        id: 'h',
        label: 'Hits',
        leaders: eligiblePlayers
          .filter((player: any) => player.id === 'manual:a')
          .map((player: any) => ({
            playerId: player.id,
            playerName: player.name,
            playerNumber: player.number,
            rank: 1,
            formattedValue: '1'
          }))
      }]
    } as any));
    firebaseMocks.collection.mockImplementation((_db: unknown, path: string) => path);
    firebaseMocks.getDocs.mockImplementation(async (path: string) => {
      if (path.includes('/diamond-game-b/')) {
        return teamSnapshot(
          buildTeamDiamondPlayerDoc(laterGame, 'player-1', { playerName: 'Game-time Pat', playerNumber: '7' }),
          buildTeamDiamondPlayerDoc(laterGame, 'manual:a', { playerName: 'Removed Avery', playerNumber: '4' })
        );
      }
      return teamSnapshot(
        buildTeamDiamondPlayerDoc(earlierGame, 'player-1', { playerName: 'Earlier Pat', playerNumber: '5' }),
        buildTeamDiamondPlayerDoc(earlierGame, 'manual:z', { playerName: '', playerNumber: '' })
      );
    });

    const insights = await loadTeamDetailInsights('team-1', { uid: 'parent-1' } as any);
    const season = insights.rosterStatistics.seasons[0];

    expect(season.rows.map(({ playerId, playerName, playerNumber, canOpenProfile }) => ({
      playerId,
      playerName,
      playerNumber,
      canOpenProfile
    }))).toEqual([
      { playerId: 'player-1', playerName: 'Game-time Pat', playerNumber: '7', canOpenProfile: true },
      { playerId: 'manual:a', playerName: 'Removed Avery', playerNumber: '4', canOpenProfile: false },
      { playerId: 'manual:z', playerName: 'Recorded player', playerNumber: '-', canOpenProfile: false }
    ]);
    expect(buildPlayerLeaderboardSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      players: [
        { id: 'player-1', name: 'Game-time Pat', number: '7' },
        { id: 'manual:a', name: 'Removed Avery', number: '4' },
        { id: 'manual:z', name: 'Recorded player', number: '-' }
      ]
    }));
    expect(insights.leaderboards[0].leaders[0]).toMatchObject({
      playerId: 'manual:a',
      playerName: 'Removed Avery',
      canOpenProfile: false
    });
  });

  it('discovers a projected-only participant before requesting complete manager season statistics', async () => {
    const game = buildTeamDiamondGame('diamond-game-1');
    const confirmedEmptyGame = buildTeamDiamondGame('diamond-game-2', 9);
    const config = { id: 'baseball', baseType: 'Baseball', statDefinitions: [
      { id: 'h', label: 'Hits', scope: 'player', visibility: 'public' },
      { id: 'pitches', label: 'Pitches', scope: 'player', visibility: 'private', topStat: true },
      { id: 'r', label: 'Runs', scope: 'team', visibility: 'public' }
    ] };
    seasonRecordMocks.listSeasonLabels.mockReturnValue(['2026']);
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', ownerId: 'owner-1', sport: 'Baseball' });
    dbMocks.getPlayers.mockResolvedValue([]);
    dbMocks.getGames.mockResolvedValue([game, confirmedEmptyGame]);
    dbMocks.getConfigs.mockResolvedValue([config]);
    vi.mocked(selectAnalyticsConfig).mockImplementation((candidateConfigs: any[]) => candidateConfigs[0] || null);
    vi.mocked(buildPlayerLeaderboardSnapshot).mockImplementation(({ players: eligiblePlayers }: any) => ({
      topStats: [{
        id: 'pitches',
        label: 'Pitches',
        leaders: eligiblePlayers.map((player: any) => ({
          playerId: player.id,
          playerName: player.name,
          playerNumber: player.number,
          rank: 1,
          formattedValue: '44'
        }))
      }]
    } as any));
    firebaseMocks.collection.mockImplementation((_db: unknown, path: string) => path);
    firebaseMocks.getDocs.mockImplementation(async (path: string) => path.includes('/diamond-game-2/')
      ? teamSnapshot()
      : teamSnapshot(buildTeamDiamondPlayerDoc(
          game,
          'manual:guest-1',
          { playerName: 'Guest Batter', playerNumber: '44' }
        )));
    diamondManagerStatsMocks.loadDiamondManagerStats.mockResolvedValue({
      status: 'complete',
      reason: null,
      documentsByGameId: new Map([['diamond-game-1', [{
        id: 'manual:guest-1',
        data: buildTeamDiamondManagerPlayerData(game, 'manual:guest-1', {
          stats: { h: 7, pitches: 44 },
          statCoverage: { h: 'complete', pitches: 'complete' }
        })
      }]]]),
      teamDocumentsByGameId: new Map([
        ['diamond-game-1', buildTeamDiamondManagerTeamData(game)],
        ['diamond-game-2', buildTeamDiamondManagerTeamData(confirmedEmptyGame)]
      ])
    });

    const insights = await loadTeamDetailInsights('team-1', { uid: 'owner-1' } as any);
    const season = insights.rosterStatistics.seasons[0];

    expect(diamondManagerStatsMocks.loadDiamondManagerStats).toHaveBeenCalledWith(expect.objectContaining({
      teamId: 'team-1',
      games: [expect.objectContaining({ id: 'diamond-game-1' }), expect.objectContaining({ id: 'diamond-game-2' })],
      playerIds: ['manual:guest-1']
    }));
    expect(season.rows).toEqual([
      expect.objectContaining({
        playerId: 'manual:guest-1',
        playerName: 'Guest Batter',
        playerNumber: '44',
        canOpenProfile: false,
        values: expect.objectContaining({
          h: expect.objectContaining({ value: 7, status: 'complete' }),
          pitches: expect.objectContaining({ value: 44, status: 'complete' })
        })
      })
    ]);
    expect(season.diamond).toMatchObject({
      pending: false,
      requestedStatVisibility: 'manager-internal',
      statVisibility: 'manager-internal',
      privateStatsStatus: 'complete',
      publicStatsStatus: 'complete'
    });
    expect(insights.leaderboards[0].leaders[0]).toMatchObject({
      playerId: 'manual:guest-1',
      playerName: 'Guest Batter',
      canOpenProfile: false
    });
  });

  it('falls back as one public batch when complete manager results omit a projected participant', async () => {
    const game = buildTeamDiamondGame('diamond-game-1');
    const config = { id: 'baseball', baseType: 'Baseball', statDefinitions: [
      { id: 'h', label: 'Hits', scope: 'player', visibility: 'public' },
      { id: 'pitches', label: 'Pitches', scope: 'player', visibility: 'private' },
      { id: 'r', label: 'Runs', scope: 'team', visibility: 'public' }
    ] };
    seasonRecordMocks.listSeasonLabels.mockReturnValue(['2026']);
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', ownerId: 'owner-1', sport: 'Baseball' });
    dbMocks.getPlayers.mockResolvedValue([{ id: 'player-1', name: 'Roster Player', number: '7', active: true }]);
    dbMocks.getGames.mockResolvedValue([game]);
    dbMocks.getConfigs.mockResolvedValue([config]);
    vi.mocked(selectAnalyticsConfig).mockReturnValue(config as any);
    firebaseMocks.collection.mockImplementation((_db: unknown, path: string) => path);
    firebaseMocks.getDocs.mockResolvedValue(teamSnapshot(
      buildTeamDiamondPlayerDoc(game, 'player-1', { playerName: 'Roster Player', playerNumber: '7' }),
      buildTeamDiamondPlayerDoc(game, 'manual:guest-1', {
        playerName: 'Guest Batter',
        playerNumber: '44',
        stats: { h: 2 }
      })
    ));
    diamondManagerStatsMocks.loadDiamondManagerStats.mockResolvedValue({
      status: 'complete',
      reason: null,
      documentsByGameId: new Map([['diamond-game-1', [{
        id: 'player-1',
        data: buildTeamDiamondManagerPlayerData(game, 'player-1', {
          stats: { h: 9, pitches: 90 },
          statCoverage: { h: 'complete', pitches: 'complete' }
        })
      }]]]),
      teamDocumentsByGameId: new Map([['diamond-game-1', buildTeamDiamondManagerTeamData(game)]])
    });

    const insights = await loadTeamDetailInsights('team-1', { uid: 'owner-1' } as any);
    const season = insights.rosterStatistics.seasons[0];

    expect(season.columns.map(({ id }) => id)).toEqual(['h']);
    expect(season.rows.map((row) => [row.playerId, row.values.h.value])).toEqual([
      ['player-1', 1],
      ['manual:guest-1', 2]
    ]);
    expect(season.rows.every((row) => !Object.prototype.hasOwnProperty.call(row.values, 'pitches'))).toBe(true);
    expect(season.diamond).toMatchObject({
      pending: false,
      requestedStatVisibility: 'manager-internal',
      statVisibility: 'public',
      privateStatsStatus: 'partial',
      privateStatsReason: 'private-read-partial',
      publicStatsStatus: 'complete'
    });
  });

  it('retains known projected-only evidence as partial when another public game read is unavailable', async () => {
    const gameA = buildTeamDiamondGame('diamond-game-a', 8);
    const gameB = buildTeamDiamondGame('diamond-game-b', 9);
    const config = { id: 'baseball', baseType: 'Baseball', statDefinitions: [
      { id: 'h', label: 'Hits', scope: 'player', visibility: 'public' },
      { id: 'r', label: 'Runs', scope: 'team', visibility: 'public' }
    ] };
    seasonRecordMocks.listSeasonLabels.mockReturnValue(['2026']);
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', ownerId: 'owner-1', sport: 'Baseball' });
    dbMocks.getPlayers.mockResolvedValue([]);
    dbMocks.getGames.mockResolvedValue([gameA, gameB]);
    dbMocks.getConfigs.mockResolvedValue([config]);
    vi.mocked(selectAnalyticsConfig).mockReturnValue(config as any);
    firebaseMocks.collection.mockImplementation((_db: unknown, path: string) => path);
    firebaseMocks.getDocs.mockImplementation(async (path: string) => {
      if (path.includes('/diamond-game-b/')) throw new Error('public read unavailable');
      return teamSnapshot(buildTeamDiamondPlayerDoc(gameA, 'manual:known', {
        playerName: 'Known Guest',
        playerNumber: '8'
      }));
    });

    const insights = await loadTeamDetailInsights('team-1', { uid: 'owner-1' } as any);
    const season = insights.rosterStatistics.seasons[0];

    expect(diamondManagerStatsMocks.loadDiamondManagerStats).not.toHaveBeenCalled();
    expect(season.rows).toEqual([
      expect.objectContaining({
        playerId: 'manual:known',
        playerName: 'Known Guest',
        canOpenProfile: false,
        values: expect.objectContaining({ h: expect.objectContaining({ value: 1, status: 'partial' }) })
      })
    ]);
    expect(season.diamond).toMatchObject({
      pending: true,
      requestedStatVisibility: 'manager-internal',
      statVisibility: 'public',
      privateStatsStatus: 'partial',
      privateStatsReason: 'public-participant-read-incomplete',
      publicStatsStatus: 'partial'
    });
  });

  it('does not cache a partial nonempty Diamond season and expands it on a later ordinary load', async () => {
    const game1 = buildTeamDiamondGame('diamond-game-1', 8);
    const game2 = buildTeamDiamondGame('diamond-game-2', 9);
    const config = { id: 'baseball', baseType: 'Baseball', statDefinitions: [
      { id: 'h', label: 'Hits', scope: 'player', visibility: 'public' },
      { id: 'r', label: 'Runs', scope: 'team', visibility: 'public' }
    ] };
    seasonRecordMocks.listSeasonLabels.mockReturnValue(['2026']);
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', sport: 'Baseball' });
    dbMocks.getGames.mockResolvedValue([game1, game2]);
    dbMocks.getConfigs.mockResolvedValue([config]);
    vi.mocked(selectAnalyticsConfig).mockReturnValue(config as any);
    firebaseMocks.collection.mockImplementation((_db: unknown, path: string) => path);
    let game2Reads = 0;
    firebaseMocks.getDocs.mockImplementation(async (path: string) => {
      if (path.includes('/diamond-game-2/')) {
        game2Reads += 1;
        if (game2Reads === 1) throw new Error('temporary partial read');
        return teamSnapshot(buildTeamDiamondPlayerDoc(game2));
      }
      return teamSnapshot(buildTeamDiamondPlayerDoc(game1));
    });

    const first = await loadTeamDetailInsights('team-1', { uid: 'parent-1' } as any);
    expect(first.rosterStatistics.seasons[0].diamond).toMatchObject({ pending: true, publicStatsStatus: 'partial' });
    expect(first.rosterStatistics.seasons[0].rows[0].values.h.value).toBe(1);

    const expanded = await loadTeamDetailInsights('team-1', { uid: 'parent-1' } as any);
    expect(expanded.rosterStatistics.seasons[0].diamond).toMatchObject({ pending: false, publicStatsStatus: 'complete' });
    expect(expanded.rosterStatistics.seasons[0].rows[0].values.h.value).toBe(2);
    expect(game2Reads).toBe(2);
  });

  it('recovers an initially empty config read with one fresh exact pinned-config reload', async () => {
    const game = buildTeamDiamondGame('diamond-game-1');
    const exactConfig = { id: 'baseball', baseType: 'Baseball', statDefinitions: [
      { id: 'h', label: 'Hits', scope: 'player', visibility: 'public' },
      { id: 'r', label: 'Runs', scope: 'team', visibility: 'public' }
    ] };
    seasonRecordMocks.listSeasonLabels.mockReturnValue(['2026']);
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', sport: 'Baseball' });
    dbMocks.getGames.mockResolvedValue([game]);
    dbMocks.getConfigs.mockResolvedValueOnce([]).mockResolvedValueOnce([exactConfig]);
    vi.mocked(selectAnalyticsConfig).mockReturnValue(exactConfig as any);
    firebaseMocks.collection.mockImplementation((_db: unknown, path: string) => path);
    firebaseMocks.getDocs.mockResolvedValue(teamSnapshot(buildTeamDiamondPlayerDoc(game)));

    const insights = await loadTeamDetailInsights('team-1', { uid: 'parent-1' } as any);

    expect(dbMocks.getConfigs).toHaveBeenCalledTimes(2);
    expect(insights.rosterStatistics.unavailableSeasons).toEqual([]);
    expect(insights.rosterStatistics.seasons[0].rows[0].values.h.value).toBe(1);
    expect(diamondStatConfigSnapshotMocks.currentDiamondStatConfigMatchesActivation).toHaveBeenCalledWith({
      teamId: 'team-1',
      game,
      config: exactConfig
    });
  });

  it('keeps derived season rates complete across different pinned configs with the same public player stat set', async () => {
    const gameA = {
      ...buildTeamDiamondGame('diamond-game-a', 8),
      statTrackerConfigId: 'config-a'
    };
    const gameBHash = `sha256:${'d'.repeat(64)}`;
    const gameBBase = buildTeamDiamondGame('diamond-game-b', 9);
    const gameB = {
      ...gameBBase,
      statTrackerConfigId: 'config-b',
      diamondStatConfigSnapshotHash: gameBHash,
      diamondPublicTeamStats: {
        ...gameBBase.diamondPublicTeamStats,
        statConfigSnapshotHash: gameBHash
      }
    };
    const publicDefinitions = [
      { id: 'ab', label: 'At bats', scope: 'player', visibility: 'public' },
      { id: 'avg', label: 'Average', scope: 'player', visibility: 'public', formula: 'H/AB' },
      { id: 'h', label: 'Hits', scope: 'player', visibility: 'public' },
      { id: 'r', label: 'Runs', scope: 'team', visibility: 'public' }
    ];
    const configA = {
      id: 'config-a',
      baseType: 'Baseball',
      statDefinitions: [...publicDefinitions, { id: 'pitches', scope: 'player', visibility: 'private' }]
    };
    const configB = {
      id: 'config-b',
      baseType: 'Baseball',
      statDefinitions: [...publicDefinitions, { id: 'notes', scope: 'team', visibility: 'private' }]
    };
    seasonRecordMocks.listSeasonLabels.mockReturnValue(['2026']);
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', sport: 'Baseball' });
    dbMocks.getGames.mockResolvedValue([gameA, gameB]);
    dbMocks.getConfigs.mockResolvedValue([configB, configA]);
    vi.mocked(selectAnalyticsConfig).mockImplementation((candidateConfigs: any[]) => candidateConfigs[0] || null);
    firebaseMocks.collection.mockImplementation((_db: unknown, path: string) => path);
    firebaseMocks.getDocs.mockImplementation(async (path: string) => {
      const game = path.includes('/diamond-game-b/') ? gameB : gameA;
      const document = buildTeamDiamondPlayerDoc(game as ReturnType<typeof buildTeamDiamondGame>);
      return teamSnapshot({
        ...document,
        data: () => ({
          ...document.data(),
          publicStatIds: ['ab', 'avg', 'h'],
          stats: { ab: 2, h: 1 },
          derivedStats: { avg: 0.5 },
          statCoverage: { ab: 'complete', avg: 'complete', h: 'complete' },
          coverage: { batting: 'complete' }
        })
      } as any);
    });

    const insights = await loadTeamDetailInsights('team-1', { uid: 'parent-1' } as any);
    const season = insights.rosterStatistics.seasons[0];

    expect(insights.rosterStatistics.unavailableSeasons).toEqual([]);
    expect(season.rows[0].values.h).toMatchObject({ value: 2, status: 'complete' });
    expect(season.rows[0].values.ab).toMatchObject({ value: 4, status: 'complete' });
    expect(season.rows[0].values.avg).toMatchObject({ value: 0.5, status: 'complete' });
  });

  it('unions exact-matched A/B configs without including B-private values in public aggregates', async () => {
    const gameA = {
      ...buildTeamDiamondGame('diamond-game-a', 8),
      statTrackerConfigId: 'config-a'
    };
    const gameBHash = `sha256:${'d'.repeat(64)}`;
    const gameBBase = buildTeamDiamondGame('diamond-game-b', 9);
    const gameB = {
      ...gameBBase,
      statTrackerConfigId: 'config-b',
      diamondStatConfigSnapshotHash: gameBHash,
      diamondPublicTeamStats: {
        ...gameBBase.diamondPublicTeamStats,
        statConfigSnapshotHash: gameBHash
      }
    };
    const configA = { id: 'config-a', baseType: 'Baseball', statDefinitions: [
      { id: 'ab', label: 'At bats A', scope: 'player', visibility: 'public' },
      { id: 'avg', label: 'Average A', scope: 'player', visibility: 'public', formula: 'H/AB', topStat: true },
      { id: 'h', label: 'Hits A', scope: 'player', visibility: 'public', topStat: true },
      { id: 'rbi', label: 'RBI A', scope: 'player', visibility: 'public', topStat: true }
    ] };
    const configB = { id: 'config-b', baseType: 'Baseball', statDefinitions: [
      { id: 'ab', label: 'Private at bats B', scope: 'player', visibility: 'private' },
      { id: 'avg', label: 'Private average B', scope: 'player', visibility: 'private', formula: 'H/AB', topStat: true },
      { id: 'h', label: 'Private hits B', scope: 'player', visibility: 'private', topStat: true },
      { id: 'rbi', label: 'RBI B', scope: 'player', visibility: 'public', topStat: true }
    ] };
    seasonRecordMocks.listSeasonLabels.mockReturnValue(['2026']);
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', sport: 'Baseball' });
    dbMocks.getGames.mockResolvedValue([gameA, gameB]);
    dbMocks.getConfigs.mockResolvedValue([configB, configA]);
    vi.mocked(selectAnalyticsConfig).mockImplementation((candidateConfigs: any[]) => candidateConfigs[0] || null);
    firebaseMocks.collection.mockImplementation((_db: unknown, path: string) => path);
    firebaseMocks.getDocs.mockImplementation(async (path: string) => {
      if (path.includes('/diamond-game-b/')) {
        const document = buildTeamDiamondPlayerDoc(gameB);
        return teamSnapshot({
          ...document,
          data: () => ({
            ...document.data(),
            publicStatIds: ['rbi'],
            stats: { rbi: 2 },
            statCoverage: { rbi: 'complete' }
          })
        } as any);
      }
      const document = buildTeamDiamondPlayerDoc(gameA);
      return teamSnapshot({
        ...document,
        data: () => ({
          ...document.data(),
          publicStatIds: ['ab', 'avg', 'h', 'rbi'],
          stats: { ab: 2, h: 1, rbi: 1 },
          derivedStats: { avg: 0.5 },
          statCoverage: { ab: 'complete', avg: 'complete', h: 'complete', rbi: 'complete' }
        })
      } as any);
    });

    const insights = await loadTeamDetailInsights('team-1', { uid: 'parent-1' } as any);
    const season = insights.rosterStatistics.seasons[0];

    expect(insights.rosterStatistics.unavailableSeasons).toEqual([]);
    expect(season.columns.map((column) => column.id)).toEqual(['ab', 'h', 'rbi', 'avg']);
    expect(season.rows[0].values.h).toMatchObject({ value: 1, status: 'partial' });
    expect(season.rows[0].values.avg).toMatchObject({ value: null, status: 'not_collected' });
    expect(season.rows[0].values.rbi).toMatchObject({ value: 3, status: 'complete' });
    expect(buildPlayerLeaderboardSnapshot).not.toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ statDefinitions: [expect.objectContaining({ id: 'h' })] })
    }));
    expect(buildPlayerLeaderboardSnapshot).not.toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ statDefinitions: [expect.objectContaining({ id: 'avg' })] })
    }));
    expect(buildPlayerLeaderboardSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        statDefinitions: [expect.objectContaining({
          id: 'rbi',
          label: 'RBI',
          visibility: 'public'
        })]
      }),
      seasonStatsByPlayerId: { 'player-1': { rbi: 3 } }
    }));
  });

  it('retains a private top-stat presentation override only for a mixed-config manager view', async () => {
    const gameA = {
      ...buildTeamDiamondGame('diamond-game-a', 8),
      statTrackerConfigId: 'config-a'
    };
    const gameBHash = `sha256:${'d'.repeat(64)}`;
    const gameBBase = buildTeamDiamondGame('diamond-game-b', 9);
    const gameB = {
      ...gameBBase,
      statTrackerConfigId: 'config-b',
      diamondStatConfigSnapshotHash: gameBHash,
      diamondPublicTeamStats: {
        ...gameBBase.diamondPublicTeamStats,
        statConfigSnapshotHash: gameBHash
      }
    };
    const configA = { id: 'config-a', baseType: 'Baseball', statDefinitions: [
      { id: 'h', label: 'Hits A', scope: 'player', visibility: 'public', topStat: true }
    ] };
    const configB = { id: 'config-b', baseType: 'Baseball', statDefinitions: [
      { id: 'h', label: 'Hits B', scope: 'player', visibility: 'public', topStat: true },
      { id: 'pitches', label: 'Private pitches B', scope: 'player', visibility: 'private', topStat: true }
    ] };
    seasonRecordMocks.listSeasonLabels.mockReturnValue(['2026']);
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', ownerId: 'owner-1', sport: 'Baseball' });
    dbMocks.getGames.mockResolvedValue([gameA, gameB]);
    dbMocks.getConfigs.mockResolvedValue([configB, configA]);
    vi.mocked(selectAnalyticsConfig).mockImplementation((candidateConfigs: any[]) => candidateConfigs[0] || null);
    firebaseMocks.collection.mockImplementation((_db: unknown, path: string) => path);
    firebaseMocks.getDocs.mockImplementation(async (path: string) => {
      const game = path.includes('/diamond-game-b/') ? gameB : gameA;
      return teamSnapshot(buildTeamDiamondPlayerDoc(game as ReturnType<typeof buildTeamDiamondGame>));
    });
    const buildManagerPlayerDocument = (game: ReturnType<typeof buildTeamDiamondGame>) => ({
      trackingEngine: 'diamond-v2',
      authoritative: true,
      complete: true,
      projectionSchemaVersion: 1,
      playerId: 'player-1',
      side: 'home',
      instanceId: game.diamondScorebookInstanceId,
      diamondScorebookInstanceId: game.diamondScorebookInstanceId,
      projectionGeneration: game.diamondScorebookInstanceId,
      sourceRevision: game.diamondProjectionRevision,
      checkpointHash: game.diamondProjectionCheckpointHash,
      statConfigSnapshotHash: game.diamondStatConfigSnapshotHash,
      projectionHash: game.diamondProjectionHash,
      stats: { h: 1, pitches: 10 },
      observedStats: {},
      derivedStats: {},
      observedDerivedStats: {},
      statCoverage: { h: 'complete', pitches: 'complete' },
      coverage: { batting: 'complete', pitches: 'complete' },
      participated: true
    });
    const buildManagerTeamDocument = (game: ReturnType<typeof buildTeamDiamondGame>) => ({
      trackingEngine: 'diamond-v2',
      complete: true,
      projectionSchemaVersion: 1,
      side: 'home',
      instanceId: game.diamondScorebookInstanceId,
      diamondScorebookInstanceId: game.diamondScorebookInstanceId,
      projectionGeneration: game.diamondScorebookInstanceId,
      sourceRevision: game.diamondProjectionRevision,
      checkpointHash: game.diamondProjectionCheckpointHash,
      statConfigSnapshotHash: game.diamondStatConfigSnapshotHash,
      projectionHash: game.diamondProjectionHash,
      stats: {},
      observedStats: {},
      statCoverage: {},
      coverage: {},
      inningLines: {}
    });
    diamondManagerStatsMocks.loadDiamondManagerStats.mockImplementation(async ({ games: requestedGames }: any) => ({
      status: 'complete',
      reason: null,
      documentsByGameId: new Map(requestedGames.map((game: any) => [game.id, [{
        id: 'player-1',
        data: buildManagerPlayerDocument(game)
      }]])),
      teamDocumentsByGameId: new Map(requestedGames.map((game: any) => [game.id, buildManagerTeamDocument(game)]))
    }));

    const insights = await loadTeamDetailInsights('team-1', { uid: 'owner-1' } as any);

    expect(insights.rosterStatistics.unavailableSeasons).toEqual([]);
    expect(firebaseMocks.getDocs).toHaveBeenCalledTimes(2);
    expect(buildPlayerLeaderboardSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        statDefinitions: [expect.objectContaining({
          id: 'pitches',
          label: 'Private pitches B',
          topStat: true
        })]
      }),
      seasonStatsByPlayerId: expect.objectContaining({
        'player-1': expect.objectContaining({ pitches: 20 })
      })
    }));
  });

  it('fails closed before public reads when a same-ID config changes a pinned visibility', async () => {
    const game = buildTeamDiamondGame('diamond-game-1');
    const mutatedConfig = { id: 'baseball', baseType: 'Baseball', statDefinitions: [
      { id: 'h', label: 'Hits', scope: 'player', visibility: 'private' },
      { id: 'r', label: 'Runs', scope: 'team', visibility: 'public' }
    ] };
    seasonRecordMocks.listSeasonLabels.mockReturnValue(['2026']);
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', sport: 'Baseball' });
    dbMocks.getGames.mockResolvedValue([game]);
    dbMocks.getConfigs.mockResolvedValue([mutatedConfig]);
    vi.mocked(selectAnalyticsConfig).mockReturnValue(mutatedConfig as any);
    diamondStatConfigSnapshotMocks.currentDiamondStatConfigMatchesActivation.mockReturnValue(false);

    const insights = await loadTeamDetailInsights('team-1', { uid: 'parent-1' } as any);

    expect(diamondStatConfigSnapshotMocks.currentDiamondStatConfigMatchesActivation).toHaveBeenCalledWith({
      teamId: 'team-1',
      game,
      config: mutatedConfig
    });
    expect(insights.rosterStatistics.unavailableSeasons).toEqual(['2026']);
    expect(insights.rosterStatistics.seasons[0].rows).toEqual([]);
    expect(insights.leaderboards).toEqual([]);
    expect(dbMocks.getConfigs).toHaveBeenCalledTimes(2);
    expect(firebaseMocks.getDocs).not.toHaveBeenCalled();
    expect(dbMocks.getAggregatedStatsForGames).not.toHaveBeenCalled();

    const exactConfig = {
      ...mutatedConfig,
      statDefinitions: mutatedConfig.statDefinitions.map((definition) => (
        definition.id === 'h' ? { ...definition, visibility: 'public' } : definition
      ))
    };
    dbMocks.getConfigs.mockResolvedValue([exactConfig]);
    vi.mocked(selectAnalyticsConfig).mockReturnValue(exactConfig as any);
    diamondStatConfigSnapshotMocks.currentDiamondStatConfigMatchesActivation.mockReturnValue(true);
    firebaseMocks.collection.mockImplementation((_db: unknown, path: string) => path);
    firebaseMocks.getDocs.mockResolvedValue(teamSnapshot(buildTeamDiamondPlayerDoc(game)));

    const recovered = await loadTeamDetailInsights('team-1', { uid: 'parent-1' } as any);

    expect(dbMocks.getConfigs).toHaveBeenCalledTimes(3);
    expect(recovered.rosterStatistics.unavailableSeasons).toEqual([]);
    expect(recovered.rosterStatistics.seasons[0].rows[0].values.h.value).toBe(1);
  });

  it('fails closed without treating an unavailable pinned config as an empty season', async () => {
    const game = buildTeamDiamondGame('diamond-game-1');
    seasonRecordMocks.listSeasonLabels.mockReturnValue(['2026']);
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', sport: 'Baseball' });
    dbMocks.getGames.mockResolvedValue([game]);
    dbMocks.getConfigs.mockResolvedValue([]);

    const insights = await loadTeamDetailInsights('team-1', { uid: 'parent-1' } as any);

    expect(insights.rosterStatistics.unavailableSeasons).toEqual(['2026']);
    expect(insights.rosterStatistics.seasons[0].rows).toEqual([]);
    expect(insights.leaderboards).toEqual([]);
    expect(dbMocks.getConfigs).toHaveBeenCalledTimes(2);
    expect(diamondStatConfigSnapshotMocks.currentDiamondStatConfigMatchesActivation).not.toHaveBeenCalled();
    expect(firebaseMocks.getDocs).not.toHaveBeenCalled();
  });

  it('fails closed when same-ID games require distinct pinned catalog hashes', async () => {
    const firstGame = buildTeamDiamondGame('diamond-game-1', 8);
    const secondGame = {
      ...buildTeamDiamondGame('diamond-game-2', 9),
      diamondStatConfigSnapshotHash: `sha256:${'d'.repeat(64)}`
    };
    const config = { id: 'baseball', baseType: 'Baseball', statDefinitions: [
      { id: 'h', label: 'Hits', scope: 'player', visibility: 'public' },
      { id: 'r', label: 'Runs', scope: 'team', visibility: 'public' }
    ] };
    seasonRecordMocks.listSeasonLabels.mockReturnValue(['2026']);
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', sport: 'Baseball' });
    dbMocks.getGames.mockResolvedValue([firstGame, secondGame]);
    dbMocks.getConfigs.mockResolvedValue([config]);
    vi.mocked(selectAnalyticsConfig).mockReturnValue(config as any);
    diamondStatConfigSnapshotMocks.currentDiamondStatConfigMatchesActivation.mockImplementation(({ game: candidateGame }: any) => (
      candidateGame.diamondStatConfigSnapshotHash === firstGame.diamondStatConfigSnapshotHash
    ));

    const insights = await loadTeamDetailInsights('team-1', { uid: 'parent-1' } as any);

    expect(insights.rosterStatistics.unavailableSeasons).toEqual(['2026']);
    expect(insights.rosterStatistics.seasons[0].rows).toEqual([]);
    expect(firebaseMocks.getDocs).not.toHaveBeenCalled();
  });

  it('omits configured private Diamond stats and never ranks an unavailable player as zero', async () => {
    __resetTeamDetailBaseSnapshotCacheForTests();
    seasonRecordMocks.listSeasonLabels.mockReturnValue(['2026']);
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', sport: 'Baseball' });
    dbMocks.getPlayers.mockResolvedValue([
      { id: 'player-1', name: 'Pat Star', number: '9', active: true },
      { id: 'player-2', name: 'Sam Bench', number: '12', active: true }
    ]);
    const instanceId = '00000000-0000-4000-8000-000000000001';
    const checkpointHash = `sha256:${'a'.repeat(64)}`;
    const configHash = `sha256:${'b'.repeat(64)}`;
    const projectionHash = `sha256:${'c'.repeat(64)}`;
    dbMocks.getGames.mockResolvedValue([{
      id: 'game-1',
      teamId: 'team-1',
      status: 'completed',
      seasonLabel: '2026',
      date: '2026-03-01',
      trackingEngine: 'diamond-v2',
      statTrackerConfigId: 'baseball',
      diamondProjectionStatus: 'current',
      diamondProjectionRevision: 8,
      diamondProjectionComplete: true,
      diamondScorebookInstanceId: instanceId,
      diamondProjectionCheckpointHash: checkpointHash,
      diamondStatConfigSnapshotHash: configHash,
      diamondProjectionHash: projectionHash,
      diamondPublicTeamStats: {
        trackingEngine: 'diamond-v2',
        projectionSchemaVersion: 1,
        sourceRevision: 8,
        checkpointHash,
        coverage: { batting: 'complete', fielding: 'complete' },
        publicStatIds: ['r'],
        side: 'home',
        complete: true,
        stats: { r: 2 },
        observedStats: {},
        statCoverage: { r: 'complete' },
        teamId: 'team-1',
        diamondGameId: 'game-1',
        instanceId,
        diamondScorebookInstanceId: instanceId,
        projectionGeneration: instanceId,
        statConfigSnapshotHash: configHash,
        projectionHash
      },
      rulesProfileId: 'baseball-youth@1',
      homeScore: 2,
      awayScore: 1
    }]);
    const config = {
      id: 'baseball',
      baseType: 'Baseball',
      columns: ['H'],
      statDefinitions: [
        { id: 'h', label: 'Hits', scope: 'player', visibility: 'public', topStat: true },
        { id: 'pitches', label: 'Pitch count', scope: 'player', visibility: 'private', topStat: true },
        { id: 'r', label: 'Runs', scope: 'team', visibility: 'public' },
        { id: 'h', label: 'Team hits', scope: 'team', visibility: 'private' }
      ]
    };
    dbMocks.getConfigs.mockResolvedValue([config]);
    vi.mocked(selectAnalyticsConfig).mockReturnValue(config as any);
    firebaseMocks.collection.mockImplementation((_db: unknown, path: string) => path);
    firebaseMocks.getDocs.mockResolvedValue({
      forEach(callback: (docSnap: any) => void) {
        [
          {
            id: 'player-1',
            data: () => ({
              schemaVersion: 1,
              trackingEngine: 'diamond-v2',
              projectionSchemaVersion: 1,
              playerId: 'player-1',
              playerName: 'Pat Star',
              playerNumber: '9',
              sourceRevision: 8,
              checkpointHash,
              complete: true,
              publicStatIds: ['h'],
              stats: { h: 2 },
              observedStats: {},
              derivedStats: {},
              observedDerivedStats: {},
              statCoverage: { h: 'complete' },
              statSources: {},
              sourcePlayIds: [],
              unavailableDerivedStats: [],
              missingStatFamilies: [],
              coverage: { batting: 'complete' },
              participated: true,
              participationStatus: 'appeared',
              participationSource: 'diamond-v2',
              teamId: 'team-1',
              diamondGameId: 'game-1',
              instanceId,
              diamondScorebookInstanceId: instanceId,
              projectionGeneration: instanceId,
              statConfigSnapshotHash: configHash,
              projectionHash
            })
          },
          {
            id: 'player-2',
            data: () => ({
              schemaVersion: 1,
              trackingEngine: 'diamond-v2',
              projectionSchemaVersion: 1,
              playerId: 'player-2',
              playerName: 'Sam Bench',
              playerNumber: '12',
              sourceRevision: 8,
              checkpointHash,
              complete: true,
              publicStatIds: ['h'],
              stats: {},
              observedStats: {},
              derivedStats: {},
              observedDerivedStats: {},
              statCoverage: { h: 'not_collected' },
              statSources: {},
              sourcePlayIds: [],
              unavailableDerivedStats: [],
              missingStatFamilies: [],
              coverage: { batting: 'not_collected' },
              participated: false,
              participationStatus: 'did-not-appear',
              participationSource: 'diamond-v2',
              didNotPlay: true,
              teamId: 'team-1',
              diamondGameId: 'game-1',
              instanceId,
              diamondScorebookInstanceId: instanceId,
              projectionGeneration: instanceId,
              statConfigSnapshotHash: configHash,
              projectionHash
            })
          }
        ].forEach(callback);
      }
    });

    const insights = await loadTeamDetailInsights('team-1', { uid: 'parent-1' } as any);
    const season = insights.rosterStatistics.seasons[0];

    expect(season.columns.map((column) => column.id)).toContain('h');
    expect(season.columns.map((column) => column.id)).not.toContain('pitches');
    expect(season.rows[0].values.h).toMatchObject({ value: 2, status: 'complete' });
    expect(season.rows[1].values.h).toMatchObject({ value: null, formattedValue: '—', status: 'not_collected' });
    expect(season.teamStats?.columns.map((column) => column.id)).toEqual(['r']);
    expect(season.teamStats?.values.r).toMatchObject({ value: 2, formattedValue: '2', status: 'complete' });
    expect(season.teamStats?.values).not.toHaveProperty('h');
    expect(diamondStatConfigSnapshotMocks.currentDiamondStatConfigMatchesActivation).toHaveBeenCalledWith({
      teamId: 'team-1',
      game: expect.objectContaining({ id: 'game-1', statTrackerConfigId: 'baseball' }),
      config
    });
    expect(firebaseMocks.getDocs).toHaveBeenCalledTimes(1);
    expect(firebaseMocks.collection).toHaveBeenCalledWith(
      firebaseMocks.db,
      `teams/team-1/games/game-1/diamondStatGenerations/${instanceId}/publicPlayerStats`
    );
    expect(buildPlayerLeaderboardSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      players: [{ id: 'player-1', name: 'Pat Star', number: '9' }]
    }));
  });

  it('retries the whole manager attempt when a player chunk omits its required team document', async () => {
    const { games } = prepareBoundedDiamondManagerSeason(1, 1);
    let callCount = 0;
    diamondManagerStatsMocks.loadDiamondManagerStats.mockImplementation(async ({ games: requestedGames, playerIds }: any) => {
      callCount += 1;
      return buildBoundedDiamondManagerResult(requestedGames, playerIds, {
        includeTeamDocuments: callCount > 1
      });
    });

    const insights = await loadTeamDetailInsights('team-1', { uid: 'owner-1' } as any);
    const season = insights.rosterStatistics.seasons[0];

    expect(diamondManagerStatsMocks.loadDiamondManagerStats).toHaveBeenCalledTimes(2);
    expect(diamondManagerStatsMocks.loadDiamondManagerStats.mock.calls.map(([request]) => request.games)).toEqual([
      games,
      games
    ]);
    expect(season.columns.map(({ id }) => id)).toEqual(expect.arrayContaining(['h', 'pitches']));
    expect(season.rows[0].values).toMatchObject({
      h: expect.objectContaining({ value: 9 }),
      pitches: expect.objectContaining({ value: 9 })
    });
    expect(season.diamond).toMatchObject({
      statVisibility: 'manager-internal',
      privateStatsStatus: 'complete',
      privateStatsReason: null
    });
  });

  it('falls back to the complete public batch when every manager attempt omits a team document', async () => {
    prepareBoundedDiamondManagerSeason(1, 1);
    diamondManagerStatsMocks.loadDiamondManagerStats.mockImplementation(async ({ games: requestedGames, playerIds }: any) => (
      buildBoundedDiamondManagerResult(requestedGames, playerIds, { includeTeamDocuments: false })
    ));

    const insights = await loadTeamDetailInsights('team-1', { uid: 'owner-1' } as any);
    const season = insights.rosterStatistics.seasons[0];

    expect(diamondManagerStatsMocks.loadDiamondManagerStats).toHaveBeenCalledTimes(2);
    expect(season.columns.map(({ id }) => id)).toEqual(['h']);
    expect(season.rows[0].values.h.value).toBe(1);
    expect(season.rows[0].values).not.toHaveProperty('pitches');
    expect(season.diamond).toMatchObject({
      statVisibility: 'public',
      privateStatsStatus: 'partial',
      publicStatsStatus: 'complete'
    });
  });

  it('retries malformed manager team evidence and never exposes its private player documents', async () => {
    prepareBoundedDiamondManagerSeason(1, 1);
    diamondManagerStatsMocks.loadDiamondManagerStats.mockImplementation(async ({ games: requestedGames, playerIds }: any) => (
      buildBoundedDiamondManagerResult(requestedGames, playerIds, { malformedTeamDocuments: true })
    ));

    const insights = await loadTeamDetailInsights('team-1', { uid: 'owner-1' } as any);
    const season = insights.rosterStatistics.seasons[0];

    expect(diamondManagerStatsMocks.loadDiamondManagerStats).toHaveBeenCalledTimes(2);
    expect(season.columns.map(({ id }) => id)).toEqual(['h']);
    expect(season.rows[0].values.h.value).toBe(1);
    expect(season.rows[0].values).not.toHaveProperty('pitches');
    expect(season.diamond).toMatchObject({ statVisibility: 'public', privateStatsStatus: 'partial' });
  });

  it('retries conflicting repeated team evidence as a whole attempt', async () => {
    prepareBoundedDiamondManagerSeason(1, 26);
    let callCount = 0;
    diamondManagerStatsMocks.loadDiamondManagerStats.mockImplementation(async ({ games: requestedGames, playerIds }: any) => {
      callCount += 1;
      return buildBoundedDiamondManagerResult(requestedGames, playerIds, {
        teamStatValue: callCount % 2 === 1 ? 1 : 2
      });
    });

    const insights = await loadTeamDetailInsights('team-1', { uid: 'owner-1' } as any);
    const season = insights.rosterStatistics.seasons[0];

    expect(diamondManagerStatsMocks.loadDiamondManagerStats).toHaveBeenCalledTimes(4);
    expect(season.columns.map(({ id }) => id)).toEqual(['h']);
    expect(season.rows).toHaveLength(26);
    expect(season.rows.every((row) => row.values.h.value === 1 && !Object.prototype.hasOwnProperty.call(row.values, 'pitches'))).toBe(true);
    expect(season.diamond).toMatchObject({ statVisibility: 'public', privateStatsStatus: 'partial' });
  });

  it('retries a 41-game by 26-player Cartesian load and never mixes private rows after a later chunk fails', async () => {
    prepareBoundedDiamondManagerSeason(41, 26);
    let callCount = 0;
    diamondManagerStatsMocks.loadDiamondManagerStats.mockImplementation(async ({ games: requestedGames, playerIds }: any) => {
      callCount += 1;
      return buildBoundedDiamondManagerResult(requestedGames, playerIds, {
        includeTeamDocuments: callCount % 4 !== 0,
        privateStatValue: 99
      });
    });

    const insights = await loadTeamDetailInsights('team-1', { uid: 'owner-1' } as any);
    const season = insights.rosterStatistics.seasons[0];

    expect(diamondManagerStatsMocks.loadDiamondManagerStats).toHaveBeenCalledTimes(8);
    expect(diamondManagerStatsMocks.loadDiamondManagerStats.mock.calls.map(([request]) => (
      `${request.games.length}x${request.playerIds.length}`
    ))).toEqual([
      '40x25', '40x1', '1x25', '1x1',
      '40x25', '40x1', '1x25', '1x1'
    ]);
    expect(season.columns.map(({ id }) => id)).toEqual(['h']);
    expect(season.rows).toHaveLength(26);
    expect(season.rows.every((row) => row.values.h.value === 41 && !Object.prototype.hasOwnProperty.call(row.values, 'pitches'))).toBe(true);
    expect(season.diamond).toMatchObject({
      statVisibility: 'public',
      privateStatsStatus: 'partial',
      publicStatsStatus: 'complete'
    });
  });

  it('loads 26-player manager statistics in bounded coherent player chunks', async () => {
    __resetTeamDetailBaseSnapshotCacheForTests();
    seasonRecordMocks.listSeasonLabels.mockReturnValue(['2026']);
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', ownerId: 'owner-1', sport: 'Baseball' });
    const players = Array.from({ length: 26 }, (_, index) => ({
      id: `player-${String(index + 1).padStart(2, '0')}`,
      name: `Player ${String(index + 1)}`,
      number: String(index + 1),
      active: true
    }));
    dbMocks.getPlayers.mockResolvedValue(players);
    const instanceId = '00000000-0000-4000-8000-000000000001';
    const checkpointHash = `sha256:${'a'.repeat(64)}`;
    const configHash = `sha256:${'b'.repeat(64)}`;
    const projectionHash = `sha256:${'c'.repeat(64)}`;
    const game = {
      id: 'game-1',
      teamId: 'team-1',
      status: 'completed',
      seasonLabel: '2026',
      date: '2026-03-01',
      trackingEngine: 'diamond-v2',
      statTrackerConfigId: 'baseball',
      diamondProjectionStatus: 'current',
      diamondProjectionRevision: 8,
      diamondProjectionComplete: true,
      diamondScorebookInstanceId: instanceId,
      diamondProjectionCheckpointHash: checkpointHash,
      diamondStatConfigSnapshotHash: configHash,
      diamondProjectionHash: projectionHash,
      rulesProfileId: 'baseball-youth@1',
      homeScore: 3,
      awayScore: 1
    };
    dbMocks.getGames.mockResolvedValue([game]);
    const config = {
      id: 'baseball',
      baseType: 'Baseball',
      statDefinitions: [
        { id: 'h', label: 'Hits', scope: 'player', visibility: 'public' },
        { id: 'r', label: 'Runs', scope: 'team', visibility: 'public' }
      ]
    };
    dbMocks.getConfigs.mockResolvedValue([config]);
    vi.mocked(selectAnalyticsConfig).mockReturnValue(config as any);
    firebaseMocks.collection.mockImplementation((_db: unknown, path: string) => path);
    firebaseMocks.getDocs.mockResolvedValue(teamSnapshot(...players.map((player) => buildTeamDiamondPlayerDoc(
      game as ReturnType<typeof buildTeamDiamondGame>,
      player.id,
      { playerName: player.name, playerNumber: player.number }
    ))));
    const teamDocument = {
      trackingEngine: 'diamond-v2',
      complete: true,
      projectionSchemaVersion: 1,
      side: 'home',
      instanceId,
      diamondScorebookInstanceId: instanceId,
      projectionGeneration: instanceId,
      sourceRevision: 8,
      checkpointHash,
      statConfigSnapshotHash: configHash,
      projectionHash,
      stats: { r: 3 },
      observedStats: {},
      statCoverage: { r: 'complete' },
      coverage: { batting: 'complete' },
      inningLines: {}
    };
    diamondManagerStatsMocks.loadDiamondManagerStats.mockImplementation(async ({ games: requestedGames, playerIds }: any) => ({
      status: 'complete',
      reason: null,
      documentsByGameId: new Map(requestedGames.map((requestedGame: any) => [requestedGame.id, playerIds.map((playerId: string) => ({
        id: playerId,
        data: {
          trackingEngine: 'diamond-v2',
          authoritative: true,
          complete: true,
          projectionSchemaVersion: 1,
          playerId,
          side: 'home',
          instanceId,
          diamondScorebookInstanceId: instanceId,
          projectionGeneration: instanceId,
          sourceRevision: 8,
          checkpointHash,
          statConfigSnapshotHash: configHash,
          projectionHash,
          stats: { h: 1 },
          observedStats: {},
          derivedStats: {},
          observedDerivedStats: {},
          statCoverage: { h: 'complete' },
          coverage: { batting: 'complete' },
          participated: true
        }
      }))])),
      teamDocumentsByGameId: new Map(requestedGames.map((requestedGame: any) => [requestedGame.id, teamDocument]))
    }));

    const insights = await loadTeamDetailInsights('team-1', { uid: 'owner-1' } as any);
    const season = insights.rosterStatistics.seasons[0];

    expect(diamondManagerStatsMocks.loadDiamondManagerStats).toHaveBeenCalledTimes(2);
    expect(diamondManagerStatsMocks.loadDiamondManagerStats.mock.calls.map(([request]) => request.games.length)).toEqual([1, 1]);
    expect(diamondManagerStatsMocks.loadDiamondManagerStats.mock.calls.map(([request]) => request.playerIds.length)).toEqual([25, 1]);
    expect(firebaseMocks.getDocs).toHaveBeenCalledTimes(1);
    expect(season.rows).toHaveLength(26);
    expect(season.rows.every((row) => row.values.h.value === 1)).toBe(true);
    expect(season.teamStats?.values.r.value).toBe(3);
    expect(season.diamond).toMatchObject({
      pending: false,
      requestedStatVisibility: 'manager-internal',
      statVisibility: 'manager-internal',
      privateStatsStatus: 'complete',
      privateStatsReason: null,
      publicStatsStatus: 'complete'
    });
  });

  it('marks only the season whose roster aggregation fails as unavailable', async () => {
    __resetTeamDetailBaseSnapshotCacheForTests();
    seasonRecordMocks.listSeasonLabels.mockReturnValue(['2026', '2025']);
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', sport: 'Basketball' });
    dbMocks.getPlayers.mockResolvedValue([{ id: 'player-1', name: 'Pat Star', number: '9', active: true }]);
    dbMocks.getGames.mockResolvedValue([
      { id: 'current-game', status: 'completed', seasonLabel: '2026', date: '2026-03-01', homeScore: 1, awayScore: 0 },
      { id: 'old-game', status: 'completed', seasonLabel: '2025', date: '2025-03-01', homeScore: 1, awayScore: 0 }
    ]);
    dbMocks.getConfigs.mockResolvedValue([{ id: 'config-1', columns: ['PTS'], statDefinitions: [{ id: 'pts', label: 'PTS', scope: 'player', visibility: 'public' }] }]);
    dbMocks.getAggregatedStatsForGames.mockImplementation(async (_teamId: string, gameIds: string[]) => {
      if (gameIds.includes('old-game')) throw new Error('aggregation unavailable');
      return { 'player-1': { pts: 12 } };
    });

    const insights = await loadTeamDetailInsights('team-1', { uid: 'parent-1' } as any);

    expect(insights.rosterStatistics.unavailableSeasons).toEqual(['2025']);
    expect(insights.rosterStatistics.seasons[0].rows[0].values.pts.value).toBe(12);
    expect(insights.rosterStatistics.seasons[1].rows).toEqual([]);
  });

  it('never hydrates or returns private roster contacts for a non-manager', async () => {
    dbMocks.getPlayers.mockResolvedValue([{
      id: 'player-1',
      name: 'Pat Star',
      active: true,
      privateProfileParents: [{ userId: 'parent-1', email: 'private@example.com', relation: 'Parent' }]
    }]);

    const model = await loadParentTeamDetailBootstrap('team-1', { uid: 'parent-1' } as any);

    expect(dbMocks.getPlayersWithPrivateRosterContacts).not.toHaveBeenCalled();
    expect(model.players[0]).not.toHaveProperty('parentContacts');
  });

  it('scopes privileged roster contacts to managers and never reuses them for a later non-manager view', async () => {
    const publicPlayers = [{ id: 'player-1', name: 'Pat Star', active: true }];
    dbMocks.getPlayers.mockResolvedValue(publicPlayers);
    dbMocks.getPlayersWithPrivateRosterContacts.mockResolvedValue([{
      ...publicPlayers[0],
      privateProfileParents: [{ userId: 'parent-1', email: 'private@example.com', relation: 'Parent' }]
    }]);

    const managerModel = await loadParentTeamDetailBootstrap('team-1', { uid: 'owner-1' } as any);
    const nonManagerModel = await loadParentTeamDetailBootstrap('team-1', { uid: 'parent-1' } as any);

    expect(dbMocks.getPlayersWithPrivateRosterContacts).toHaveBeenCalledTimes(1);
    expect(dbMocks.getPlayersWithPrivateRosterContacts).toHaveBeenCalledWith('team-1', {
      includeInactive: true,
      players: publicPlayers
    });
    expect(managerModel.players[0].parentContacts).toEqual([
      { userId: 'parent-1', email: 'private@example.com', relation: 'Parent' }
    ]);
    expect(nonManagerModel.players[0]).not.toHaveProperty('parentContacts');
  });
});

describe('tracking admin helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', ownerId: 'owner-1', adminEmails: ['coach@example.com'] });
    dbMocks.getPlayers.mockResolvedValue([
      { id: 'player-1', name: 'Pat Star', number: '9', active: true },
      { id: 'player-2', name: 'Sam Bench', number: '12', active: false }
    ]);
    dbMocks.getGames.mockResolvedValue([]);
    dbMocks.getConfigs.mockResolvedValue([]);
    firebaseMocks.collection.mockImplementation((...parts) => parts.join('/'));
    firebaseMocks.doc.mockImplementation((...parts) => ({ path: parts.join('/') }));
    firebaseMocks.where.mockImplementation((...parts) => ({ kind: 'where', parts }));
    firebaseMocks.query.mockImplementation((target, ...constraints) => ({ target, constraints }));
    __resetTeamDetailBaseSnapshotCacheForTests();
  });

  it('loads tracking statuses from each legacy nested memberTracking path, excludes inactive players, and summarizes completion by item', async () => {
    firebaseMocks.getDocs.mockImplementation(async (input) => {
      if (typeof input === 'string' && input.endsWith('/trackingItems')) {
        return {
          docs: [
            { id: 'item-1', data: () => ({ name: 'Waiver', visibility: 'public', status: 'active', active: true, archived: false }) },
            { id: 'item-2', data: () => ({ name: 'Jersey', visibility: 'private', status: 'archived', active: false, archived: true }) }
          ]
        };
      }
      if (typeof input === 'string' && input.endsWith('/trackingItems/item-1/memberTracking')) {
        return {
          docs: [
            { id: 'status-1', data: () => ({ teamId: 'team-1', trackingItemId: 'item-1', playerId: 'player-1', status: 'complete', complete: true }) },
            { id: 'status-mismatch', data: () => ({ teamId: 'team-1', trackingItemId: 'item-2', playerId: 'player-1', status: 'complete', complete: true }) }
          ]
        };
      }
      if (typeof input === 'string' && input.endsWith('/trackingItems/item-2/memberTracking')) {
        return {
          docs: [
            { id: 'status-2', data: () => ({ teamId: 'team-1', trackingItemId: 'item-2', playerId: 'player-1', status: 'open', complete: false }) }
          ]
        };
      }
      return { docs: [] };
    });

    const items = await loadTeamTrackingAdmin('team-1', { uid: 'owner-1', email: 'owner@example.com' } as any);

    expect(items).toEqual([
      expect.objectContaining({
        id: 'item-2',
        status: 'archived',
        completionSummary: { total: 1, complete: 0, incomplete: 1 }
      }),
      expect.objectContaining({
        id: 'item-1',
        visibility: 'public',
        completionSummary: { total: 1, complete: 1, incomplete: 0 },
        playerStatuses: [expect.objectContaining({ playerId: 'player-1', complete: true })]
      })
    ]);
    expect(items[0].playerStatuses.some((player) => player.playerId === 'player-2')).toBe(false);
    expect(firebaseMocks.getDocs).toHaveBeenCalledTimes(3);
    expect(firebaseMocks.getDocs).toHaveBeenCalledWith('[object Object]/teams/team-1/trackingItems');
    expect(firebaseMocks.getDocs).toHaveBeenCalledWith('[object Object]/teams/team-1/trackingItems/item-1/memberTracking');
    expect(firebaseMocks.getDocs).toHaveBeenCalledWith('[object Object]/teams/team-1/trackingItems/item-2/memberTracking');
  });

  it('writes legacy-compatible tracking item docs when saving in the app', async () => {
    await saveTeamTrackingItemForApp('team-1', { uid: 'coach-1', email: 'coach@example.com' } as any, {
      name: 'Medical release form',
      description: 'Bring signed copies',
      visibility: 'public',
      status: 'archived'
    }, { itemId: 'item-1' });

    expect(firebaseMocks.updateDoc).toHaveBeenCalledWith(
      { path: '[object Object]/teams/team-1/trackingItems/item-1' },
      expect.objectContaining({
        name: 'Medical release form',
        description: 'Bring signed copies',
        visibility: 'public',
        status: 'archived',
        active: false,
        archived: true,
        teamId: 'team-1',
        updatedBy: 'coach-1'
      })
    );
  });

  it('writes per-player tracking statuses with the legacy nested payload', async () => {
    await setPlayerTrackingStatusForApp('team-1', { uid: 'coach-1', email: 'coach@example.com' } as any, 'item-1', {
      id: 'player-1',
      name: 'Pat Star',
      number: '9',
      photoUrl: null,
      position: '',
      isLinked: false,
      active: true
    }, true);

    expect(dbMocks.setTeamTrackingStatus).toHaveBeenCalledWith('team-1', 'item-1', 'player-1', expect.objectContaining({
      teamId: 'team-1',
      trackingItemId: 'item-1',
      playerId: 'player-1',
      playerName: 'Pat Star',
      playerNumber: '9',
      memberType: 'player',
      status: 'complete',
      complete: true,
      updatedBy: 'coach-1',
      updatedByEmail: 'coach@example.com'
    }));
  });
});

describe('canManageTeamAdmins adminEmails parity with legacy js/team-access.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Use the real legacy hasFullTeamAccess (not the file-level always-true mock) so this
    // test actually exercises owner/adminEmails/isAdmin parity instead of trivially passing.
    vi.mocked(hasFullTeamAccess).mockImplementation((user: any, team: any) => {
      if (!user || !team) return false;
      const isOwner = team.ownerId === user.uid;
      const normalizedEmail = String(user.email || '').trim().toLowerCase();
      const adminEmails = (Array.isArray(team.adminEmails) ? team.adminEmails : [])
        .map((email: string) => String(email || '').trim().toLowerCase());
      const isTeamAdmin = adminEmails.includes(normalizedEmail);
      const isPlatformAdmin = user.isAdmin === true;
      return isOwner || isTeamAdmin || isPlatformAdmin;
    });
    dbMocks.getTeam.mockResolvedValue({
      id: 'team-1',
      ownerId: 'owner-uid',
      ownerEmail: 'owner@example.com',
      adminEmails: ['teamadmin@example.com']
    });
    dbMocks.updateTeam.mockResolvedValue(undefined);
    __resetTeamDetailBaseSnapshotCacheForTests();
  });

  it('allows a user listed in team.adminEmails (not owner, not isAdmin) to manage admins', async () => {
    const teamAdminUser = { uid: 'admin-uid', email: 'teamadmin@example.com', roles: [] } as any;

    await expect(
      revokeTeamAdminAccessForApp('team-1', 'someoneelse@example.com', teamAdminUser)
    ).resolves.toBeUndefined();
    expect(firebaseMocks.httpsCallable).toHaveBeenCalledWith(firebaseMocks.functions, 'revokeTeamAdminAccess');
    expect(firebaseMocks.httpsCallable.mock.results[firebaseMocks.httpsCallable.mock.results.length - 1]?.value).toHaveBeenCalledWith({
      teamId: 'team-1',
      email: 'someoneelse@example.com'
    });
    expect(dbMocks.updateTeam).not.toHaveBeenCalled();
  });

  it('denies a user who is neither owner, adminEmails member, isAdmin, isPlatformAdmin, nor admin-role', async () => {
    const randomUser = { uid: 'random-uid', email: 'random@example.com', roles: [] } as any;

    await expect(
      revokeTeamAdminAccessForApp('team-1', 'teamadmin@example.com', randomUser)
    ).rejects.toThrow('You do not have permission to manage admins for this team.');
    expect(firebaseMocks.httpsCallable).not.toHaveBeenCalled();
    expect(dbMocks.updateTeam).not.toHaveBeenCalled();
  });
});

describe('buildTeamDetailModel registration provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves the authoritative non-calendar current season id', () => {
    const built = buildTeamDetailModel({
      teamId: 'team-1',
      team: { id: 'team-1', name: 'Bears', currentSeasonId: 'summer-2026' }
    });

    expect(built.team.currentSeasonId).toBe('summer-2026');
  });

  it.each([
    ['canonical owner', { uid: 'owner-1', email: 'owner@example.com' }, { ownerId: 'owner-1' }, true],
    ['verified current-email team admin', { uid: 'admin-1', email: 'ADMIN@example.com', emailVerified: true }, { ownerId: 'owner-1', adminEmails: ['admin@example.com'] }, true],
    ['unverified current-email team admin', { uid: 'admin-1', email: 'admin@example.com', emailVerified: false }, { ownerId: 'owner-1', adminEmails: ['admin@example.com'] }, false],
    ['confirmed parent', { uid: 'parent-1', email: 'parent@example.com', parentTeamIds: ['team-1'] }, { ownerId: 'owner-1' }, true],
    ['platform-admin-only user', { uid: 'platform-1', email: 'platform@example.com', isAdmin: true }, { ownerId: 'owner-1' }, false],
    ['verified legacy email-only owner', { uid: 'legacy-1', email: 'legacy@example.com', emailVerified: true }, { ownerEmail: 'legacy@example.com' }, true],
    ['unverified legacy email-only owner', { uid: 'legacy-1', email: 'legacy@example.com', emailVerified: false }, { ownerEmail: 'legacy@example.com' }, false],
    ['conflicting legacy owner aliases', { uid: 'legacy-1', email: 'legacy@example.com', emailVerified: true }, { ownerEmail: 'legacy@example.com', ownerEmailLower: 'other@example.com' }, false],
    ['stale legacy alias behind a canonical owner', { uid: 'legacy-1', email: 'legacy@example.com', emailVerified: true }, { ownerId: 'owner-1', ownerEmail: 'legacy@example.com' }, false],
    ['parent behind a malformed canonical owner', { uid: 'parent-1', email: 'parent@example.com', parentTeamIds: ['team-1'] }, { ownerId: ' owner-1 ' }, false],
    ['coach-only delegate', { uid: 'coach-1', email: 'coach@example.com', coachOf: ['team-1'] }, { ownerId: 'owner-1' }, false],
    ['linked-player-only user', { uid: 'member-1', email: 'member@example.com', parentOf: [{ teamId: 'team-1' }], parentPlayerKeys: ['team-1:player-1'] }, { ownerId: 'owner-1' }, false],
    ['scorekeeper delegate', { uid: 'scorekeeper-1', email: 'score@example.com', scorekeeperTeamIds: ['team-1'] }, { ownerId: 'owner-1' }, false],
    ['stream delegate', { uid: 'stream-1', email: 'stream@example.com', streamTeamIds: ['team-1'] }, { ownerId: 'owner-1' }, false],
    ['media and video delegate', { uid: 'media-1', email: 'media@example.com', teamMediaUploadTeamIds: ['team-1'], mediaUploadTeamIds: ['team-1'], videographerTeamIds: ['team-1'] }, { ownerId: 'owner-1' }, false],
    ['wrong-team parent', { uid: 'parent-1', email: 'parent@example.com', parentTeamIds: ['team-2'] }, { ownerId: 'owner-1' }, false]
  ])('projects private calendar eligibility for a %s', (_label, user, team, expected) => {
    expect(isEligiblePrivateCalendarSubscriberForApp(
      user as any,
      'team-1',
      { id: 'team-1', name: 'Bears', ...team }
    )).toBe(expected);

    const built = buildTeamDetailModel({
      teamId: 'team-1',
      team: { id: 'team-1', name: 'Bears', ...team },
      user: user as any
    });
    expect(built.canUsePrivateCalendarSync).toBe(expected);
  });

  it('returns no registration provider rows when the team has no registration source', () => {
    const built = buildTeamDetailModel({
      teamId: 'team-1',
      team: { id: 'team-1', name: 'Bears', sport: 'Basketball' }
    });

    expect(built.team.registrationProvider).toEqual([]);
  });

  it('does not expose the app team id as a registration provider value', () => {
    const built = buildTeamDetailModel({
      teamId: 'team-1',
      team: {
        id: 'team-1',
        name: 'Bears',
        sport: 'Basketball',
        registrationSource: {
          providerName: 'Sports Connect',
          teamId: 'team-1'
        }
      }
    });

    expect(built.team.registrationProvider).toEqual([
      { label: 'Provider', value: 'Sports Connect' }
    ]);
  });

  it('returns human-labeled rows with copyable ids when a registration source is configured', () => {
    const syncedAt = new Date(2026, 0, 2, 9, 30);
    const built = buildTeamDetailModel({
      teamId: 'team-1',
      team: {
        id: 'team-1',
        name: 'Bears',
        sport: 'Basketball',
        registrationSource: {
          provider: 'LeagueApps',
          externalTeamId: 'ext-42',
          teamId: 'provider-team-7',
          lastSyncStatus: 'sync_complete',
          lastSyncedAt: syncedAt
        }
      }
    });

    expect(built.team.registrationProvider).toEqual([
      { label: 'Provider', value: 'LeagueApps' },
      { label: 'External team ID', value: 'ext-42', copyable: true },
      { label: 'Provider team ID', value: 'provider-team-7', copyable: true },
      expect.objectContaining({ label: 'Last sync', value: expect.stringContaining('Sync Complete') })
    ]);
    expect(built.team.registrationProvider[3].value).toContain('Jan 2, 2026');
  });

  it('keeps a legacy provider-specific teamId when it is not the app team id', () => {
    const built = buildTeamDetailModel({
      teamId: 'team-1',
      team: {
        id: 'team-1',
        name: 'Bears',
        sport: 'Basketball',
        registrationSource: {
          providerName: 'LeagueApps',
          teamId: 'provider-team-44'
        }
      }
    });

    expect(built.team.registrationProvider).toEqual([
      { label: 'Provider', value: 'LeagueApps' },
      { label: 'Provider team ID', value: 'provider-team-44', copyable: true }
    ]);
  });
});

describe('buildTeamDetailModel standings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes completed non-practice games into native standings and preserves the returned current row', () => {
    vi.mocked(computeNativeStandings).mockReturnValue([
      { rank: 1, team: 'Bears', w: 1, l: 0, t: 0, points: 2 },
      { rank: 2, team: 'Lions', w: 0, l: 1, t: 0, points: 0 }
    ]);

    const built = buildTeamDetailModel({
      teamId: 'team-1',
      team: {
        id: 'team-1',
        name: 'Bears',
        sport: 'Basketball',
        standingsConfig: {
          enabled: true,
          rankingMode: 'points'
        }
      },
      players: [],
      configs: [],
      games: [
        {
          id: 'game-1',
          type: 'game',
          opponent: 'Lions',
          isHome: true,
          homeScore: 42,
          awayScore: 35,
          status: 'completed',
          date: new Date('2026-06-20T10:00:00Z')
        },
        {
          id: 'practice-1',
          type: 'practice',
          opponent: '',
          status: 'completed',
          date: new Date('2026-06-21T10:00:00Z')
        },
        {
          id: 'game-2',
          type: 'game',
          opponent: 'Tigers',
          isHome: true,
          homeScore: null,
          awayScore: null,
          status: 'scheduled',
          date: new Date('2026-06-22T10:00:00Z')
        }
      ]
    });

    expect(computeNativeStandings).toHaveBeenCalledWith([
      {
        homeTeam: 'Bears',
        awayTeam: 'Lions',
        homeScore: 42,
        awayScore: 35,
        status: 'completed'
      },
      {
        homeTeam: 'Bears',
        awayTeam: 'Tigers',
        homeScore: null,
        awayScore: null,
        status: 'scheduled'
      }
    ], {
      enabled: true,
      rankingMode: 'points'
    });
    expect(built.standings.rows).toHaveLength(2);
    expect(built.standings.currentRow).toEqual(expect.objectContaining({ team: 'Bears', rank: 1 }));
  });
});
