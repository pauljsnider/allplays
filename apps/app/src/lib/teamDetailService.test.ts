// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import {
  __resetTeamDetailBaseSnapshotCacheForTests,
  addRosterPlayerForApp,
  buildTeamAnalytics,
  buildTeamDetailModel,
  createTeamPassCheckoutForApp,
  createStatTrackerConfigForApp,
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
  firebaseMocks.httpsCallable.mockReturnValue(vi.fn().mockResolvedValue({ data: { success: true } }));
  vi.mocked(hasFullTeamAccess).mockImplementation(() => true);
  seasonRecordMocks.listSeasonLabels.mockReturnValue([]);
  dbMocks.getPlayersWithPrivateRosterContacts.mockImplementation((_teamId: string, options: any = {}) => (
    Array.isArray(options.players) ? options.players : dbMocks.getPlayers(_teamId, options)
  ));
  dbMocks.getPlayerPrivateProfile.mockResolvedValue(null);
});

describe('createTeamPassCheckoutForApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nativeRuntimeState.isNative = false;
  });

  it('creates a web checkout for the exact team and current season', async () => {
    const callable = vi.fn().mockResolvedValue({ data: { checkoutUrl: 'https://checkout.stripe.com/c/pay/team-pass' } });
    firebaseMocks.httpsCallable.mockReturnValue(callable);

    await expect(createTeamPassCheckoutForApp('team-1', 'summer-2100')).resolves.toBe('https://checkout.stripe.com/c/pay/team-pass');
    expect(firebaseMocks.httpsCallable).toHaveBeenCalledWith(firebaseMocks.functions, 'createStripeTeamPassCheckout');
    expect(callable).toHaveBeenCalledWith({ teamId: 'team-1', seasonId: 'summer-2100', tier: 'team-pass' });
  });

  it('uses the authenticated native callable transport', async () => {
    nativeRuntimeState.isNative = true;
    nativeCallableMocks.callNativeFirebaseFunction.mockResolvedValue({ checkoutUrl: 'https://checkout.stripe.com/c/pay/native-team-pass' });

    await expect(createTeamPassCheckoutForApp('team-1', 'summer-2100')).resolves.toBe('https://checkout.stripe.com/c/pay/native-team-pass');
    expect(nativeCallableMocks.callNativeFirebaseFunction).toHaveBeenCalledWith(
      'createStripeTeamPassCheckout',
      { teamId: 'team-1', seasonId: 'summer-2100', tier: 'team-pass' },
      { errorLabel: 'Team Pass checkout' }
    );
  });

  it.each([
    '',
    ' https://checkout.stripe.com/c/pay/space',
    'http://checkout.stripe.com/c/pay/insecure',
    'https://checkout.stripe.com.attacker.example/c/pay/lookalike',
    'https://user:password@checkout.stripe.com/c/pay/credentialed',
    'https://checkout.stripe.com:8443/c/pay/port',
    'https://checkout.stripe.com/'
  ])('rejects an untrusted fresh checkout destination %j', async (checkoutUrl) => {
    firebaseMocks.httpsCallable.mockReturnValue(vi.fn().mockResolvedValue({ data: { checkoutUrl } }));

    await expect(createTeamPassCheckoutForApp('team-1', 'summer-2100')).rejects.toThrow('invalid checkout destination');
  });
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

  it('recovers management access from the authoritative REST document when the web SDK returns a public projection', async () => {
    const previousFetch = globalThis.fetch;
    dbMocks.getTeam.mockResolvedValueOnce({
      id: 'team-1',
      name: 'Bears',
      sport: 'Basketball',
      isPublic: true,
      active: true
    });
    authServiceMocks.getNativeAuthIdToken.mockResolvedValueOnce('web-token');
    dbMocks.getRosterFieldDefinitions.mockResolvedValueOnce([]);
    dbMocks.applyRosterCsvImportOperations.mockResolvedValueOnce([{ playerId: 'player-2' }]);
    (globalThis as any).fetch = vi.fn(async () => ({
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
    }) as any);

    try {
      const model = await loadParentTeamDetailBootstrap('team-1', { uid: 'owner-1', roles: ['coach'] } as any);

      expect(model.canManageTeam).toBe(true);
      expect(model.team.ownerId).toBe('owner-1');
      expect(dbMocks.getPlayersWithPrivateRosterContacts).toHaveBeenCalledWith('team-1', expect.objectContaining({
        includeInactive: true
      }));
      expect(authServiceMocks.getNativeAuthIdToken).toHaveBeenCalledWith(true);

      await expect(addRosterPlayerForApp('team-1', { uid: 'owner-1', roles: ['coach'] } as any, {
        name: 'New Player'
      })).resolves.toMatchObject({ playerId: 'player-2' });
      expect(dbMocks.getTeam).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
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
    ['current-email team admin', { uid: 'admin-1', email: 'ADMIN@example.com' }, { ownerId: 'owner-1', adminEmails: ['admin@example.com'] }, true],
    ['confirmed parent', { uid: 'parent-1', email: 'parent@example.com', parentTeamIds: ['team-1'] }, { ownerId: 'owner-1' }, true],
    ['platform-admin-only user', { uid: 'platform-1', email: 'platform@example.com', isAdmin: true }, { ownerId: 'owner-1' }, false],
    ['legacy email-only owner', { uid: 'legacy-1', email: 'legacy@example.com' }, { ownerEmail: 'legacy@example.com' }, false],
    ['wrong-team parent', { uid: 'parent-1', email: 'parent@example.com', parentTeamIds: ['team-2'] }, { ownerId: 'owner-1' }, false]
  ])('projects Team Pass eligibility for a %s', (_label, user, team, expected) => {
    const built = buildTeamDetailModel({
      teamId: 'team-1',
      team: { id: 'team-1', name: 'Bears', currentSeasonId: 'summer-2026', ...team },
      user: user as any
    });

    expect(built.canPurchaseTeamPass).toBe(expected);
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
