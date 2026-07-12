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
  getPlayersWithPrivateRosterContacts: vi.fn(),
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
  getDoc: vi.fn(),
  getDocs: vi.fn(),
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
  mergeStandardRosterFieldDefinitions: vi.fn((value) => value),
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
  normalizeAdminEmailList: vi.fn(() => [])
}));
vi.mock('../../../../js/team-staff-permissions.js', () => ({ buildTeamStaffPermissionsViewModel: vi.fn(() => ({ staff: [], pendingInvites: [], helperPermissions: [], hasAnyStaff: false })) }));
vi.mock('./authService', () => authServiceMocks);
vi.mock('./inviteUrls', () => ({ buildAppAcceptInviteUrl: vi.fn(() => 'https://allplays.ai/app#/accept-invite') }));
vi.mock('./nativeRestLogging', () => ({ sanitizeErrorForLogging: vi.fn((error) => error) }));

import {
  __resetTeamDetailBaseSnapshotCacheForTests,
  buildTeamDetailModel,
  createStatTrackerConfigForApp,
  loadParentTeamDetail,
  loadParentTeamDetailBootstrap,
  loadTeamTrackingAdmin,
  revokeTeamAdminAccessForApp,
  saveTeamTrackingItemForApp,
  setPlayerTrackingStatusForApp,
  updateTeamSettingsForApp
} from './teamDetailService';
import { computeNativeStandings } from '../../../../js/native-standings.js';
import { hasFullTeamAccess } from '../../../../js/team-access.js';

beforeEach(() => {
  dbMocks.getPlayersWithPrivateRosterContacts.mockImplementation((...args: any[]) => dbMocks.getPlayers(...args));
});

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
    dbMocks.getPlayersWithPrivateRosterContacts.mockImplementation((...args: any[]) => dbMocks.getPlayers(...args));
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
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', ownerId: 'owner-1', photoUrl: 'https://img.example.test/team.png' });
    dbMocks.getPlayersWithPrivateRosterContacts.mockImplementation((...args: any[]) => dbMocks.getPlayers(...args));
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

  it('rejects invalid livestream links before writing', async () => {
    await expect(updateTeamSettingsForApp('team-1', { uid: 'owner-1' } as any, {
      name: 'Bears',
      streamUrl: 'not a stream url'
    })).rejects.toThrow('Livestream link must be a valid YouTube or Twitch URL.');

    expect(dbMocks.updateTeam).not.toHaveBeenCalled();
  });
});

describe('team detail bootstrap loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', ownerId: 'owner-1', name: 'Bears', sport: 'Basketball' });
    dbMocks.getPlayersWithPrivateRosterContacts.mockImplementation((...args: any[]) => dbMocks.getPlayers(...args));
    dbMocks.getPlayers.mockResolvedValue([{ id: 'player-1', name: 'Pat Star', active: true }]);
    dbMocks.getGames.mockResolvedValue([{ id: 'game-1', type: 'game', status: 'scheduled' }]);
    dbMocks.getConfigs.mockResolvedValue([{ id: 'config-1', name: 'Config' }]);
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

  it('loads games and stat configs once a deferred detail surface requests them', async () => {
    await loadParentTeamDetailBootstrap('team-1', { uid: 'parent-1' } as any);
    await loadParentTeamDetail('team-1', { uid: 'parent-1' } as any, { includeDeferredData: false });

    expect(dbMocks.getTeam).toHaveBeenCalledTimes(1);
    expect(dbMocks.getPlayers).toHaveBeenCalledTimes(1);
    expect(dbMocks.getGames).toHaveBeenCalledTimes(1);
    expect(dbMocks.getConfigs).toHaveBeenCalledTimes(1);
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
    expect(dbMocks.updateTeam).toHaveBeenCalled();
  });

  it('denies a user who is neither owner, adminEmails member, isAdmin, isPlatformAdmin, nor admin-role', async () => {
    const randomUser = { uid: 'random-uid', email: 'random@example.com', roles: [] } as any;

    await expect(
      revokeTeamAdminAccessForApp('team-1', 'teamadmin@example.com', randomUser)
    ).rejects.toThrow('You do not have permission to manage admins for this team.');
    expect(dbMocks.updateTeam).not.toHaveBeenCalled();
  });
});

describe('buildTeamDetailModel registration provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
