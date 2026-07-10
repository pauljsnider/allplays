import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const testDir = dirname(fileURLToPath(import.meta.url));
const readAppSource = (relativePath: string) => readFileSync(resolve(testDir, '..', relativePath), 'utf8');

const mocks = vi.hoisted(() => {
  const transactionSet = vi.fn();
  const transactionGet = vi.fn();
  const transactionDelete = vi.fn();
  const getDoc = vi.fn();
  const runTransactionMock = vi.fn(async (_db: unknown, callback: any) => callback({
    get: transactionGet,
    set: transactionSet,
    delete: transactionDelete
  }));
  return { transactionSet, transactionGet, transactionDelete, getDoc, runTransactionMock };
});

vi.mock('./adapters/legacyScheduleDb', () => ({
  db: {},
  doc: vi.fn((first: any, ...rest: any[]) => ({ path: typeof first?.path === 'string' ? [first.path, ...rest].filter(Boolean).join('/') : rest.filter(Boolean).join('/') })),
  collection: vi.fn((_db: unknown, path: string) => ({ path })),
  collectionGroup: vi.fn((_db: unknown, path: string) => ({ path, scope: 'collectionGroup' })),
  query: vi.fn((base: any, ...filters: any[]) => ({ base, filters })),
  where: vi.fn((field: string, op: string, value: any) => ({ field, op, value })),
  getDoc: mocks.getDoc,
  getDocs: vi.fn(),
  runTransaction: mocks.runTransactionMock,
  increment: vi.fn((value: number) => ({ __increment: value })),
  serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })),
  deleteField: vi.fn(() => ({ __deleteField: true })),
  Timestamp: { fromDate: vi.fn((value: Date) => value) },
  getAssignmentClaims: vi.fn(),
  claimOpenOfficiatingSlot: vi.fn(),
  getGame: vi.fn(),
  getGames: vi.fn(),
  getPracticePacketCompletions: vi.fn(),
  getPracticeSession: vi.fn(),
  getPracticeSessionByEvent: vi.fn(),
  getPracticeSessions: vi.fn(),
  getPlayers: vi.fn(),
  getRsvpBreakdownByPlayer: vi.fn(),
  getRsvps: vi.fn(),
  getRsvpSummaries: vi.fn(),
  getTeam: vi.fn(),
  getTeams: vi.fn(),
  addGame: vi.fn(),
  addPractice: vi.fn(),
  buildSingleLegacyTournamentGameDocument: vi.fn((games: Array<Record<string, unknown> | null | undefined>, tournament: Record<string, unknown>) => {
    if (games.length !== 1 || !games[0]) throw new Error('Tournament adapter only supports a single completed tournament game.');
    return {
      ...games[0],
      competitionType: 'tournament',
      tournament
    };
  }),
  buildLegacyTournamentGameDocument: vi.fn((payload: Record<string, unknown>, tournament: Record<string, unknown>) => ({
    ...payload,
    competitionType: 'tournament',
    tournament
  })),
  buildLegacyTournamentGameDocuments: vi.fn((games: Array<Record<string, unknown> | null | undefined>, tournament: Record<string, unknown>) => games
    .filter((game): game is Record<string, unknown> => Boolean(game && typeof game === 'object' && !Array.isArray(game)))
    .map((game) => ({
      ...game,
      competitionType: 'tournament',
      tournament
    }))),
  clearOccurrenceOverride: vi.fn(),
  createRideOffer: vi.fn(),
  claimAssignmentSlot: vi.fn(),
  respondToOfficiatingAssignment: vi.fn(),
  updateEvent: vi.fn(),
  updateOccurrence: vi.fn(),
  updateSeries: vi.fn(),
  requestRideSpot: vi.fn(),
  listRideOffersForEvent: vi.fn(),
  updateRideRequestStatus: vi.fn(),
  closeRideOffer: vi.fn(),
  cancelRideRequest: vi.fn(),
  releaseAssignmentClaim: vi.fn(),
  submitRsvpForPlayer: vi.fn(),
  broadcastLiveEvent: vi.fn(),
  updateGame: vi.fn(),
  updatePracticeAttendance: vi.fn(),
  updateTeam: vi.fn(),
  upsertPracticePacketCompletion: vi.fn()
}));

vi.mock('./adapters/legacyScheduleHelpers', () => ({
  sendPublicRsvpReminderEmails: vi.fn(),
  normalizeOfficialLinkEmail: vi.fn((value: unknown) => String(value || '').trim().toLowerCase()),
  normalizeOfficialLinkPhone: vi.fn((value: unknown) => String(value || '').replace(/\D+/g, '')),
  getAssignedOfficiatingSlots: vi.fn((game: any, user: any) => {
    const email = String(user?.email || '').trim().toLowerCase();
    const phone = String(user?.phone || '').replace(/\D+/g, '');
    return Array.isArray(game?.officiatingSlots)
      ? game.officiatingSlots.filter((slot: any) => {
        const slotEmail = String(slot?.officialEmail || '').trim().toLowerCase();
        const slotPhone = String(slot?.officialPhone || '').replace(/\D+/g, '');
        return Boolean((slotEmail && slotEmail === email) || (slotPhone && slotPhone === phone));
      })
      : [];
  }),
  getOpenOfficiatingSlots: vi.fn((game: any) => Array.isArray(game?.officiatingSlots)
    ? game.officiatingSlots.filter((slot: any) => String(slot?.status || '').toLowerCase() === 'open')
    : []),
  expandRecurrence: vi.fn(),
  extractOpponent: vi.fn(),
  fetchAndParseCalendar: vi.fn(),
  getCalendarEventTrackingId: vi.fn(),
  isPracticeEvent: vi.fn(),
  isTrackedCalendarEvent: vi.fn(),
  filterVisiblePracticeSessions: vi.fn((items) => items),
  buildPracticePacketCompletionPayload: vi.fn(),
  resolveMyRsvpByChildForGame: vi.fn((_events: any[], _teamId: string, _gameId: string, rsvps: any[]) => (
    (Array.isArray(rsvps) ? rsvps : []).reduce<Record<string, string>>((acc, rsvp) => {
      if (rsvp?.playerId && rsvp?.response) acc[rsvp.playerId] = rsvp.response;
      return acc;
    }, {})
  )),
  buildGameDayRsvpBreakdown: vi.fn(),
  getPeriodsForFormation: vi.fn(() => []),
  getEventRideshareSummary: vi.fn(),
  mergeAssignmentsWithClaims: vi.fn(),
  hasScorekeepingTeamAccess: vi.fn(),
  isTeamActive: vi.fn(() => true),
  applyPracticeRecurrenceFields: vi.fn((payload: any) => {
    const { practiceData, isRecurring, editingPracticeId = null, editingSeriesId = null, recurrenceConfig = {}, startDate, endDate, Timestamp, deleteField, generateSeriesId } = payload;
    if (isRecurring) {
      const { freq = 'weekly', interval = 1, byDays = [], endType = 'never', untilValue = '', countValue = 10 } = recurrenceConfig;
      practiceData.isSeriesMaster = true;
      practiceData.seriesId = editingPracticeId ? (editingSeriesId || practiceData.seriesId || generateSeriesId()) : generateSeriesId();
      const startDay = new Date(startDate);
      const endDay = new Date(endDate);
      startDay.setHours(0, 0, 0, 0);
      endDay.setHours(0, 0, 0, 0);
      practiceData.startTime = startDate.toTimeString().slice(0, 5);
      practiceData.endTime = endDate.toTimeString().slice(0, 5);
      practiceData.endDayOffset = Math.max(0, Math.round((endDay.getTime() - startDay.getTime()) / 86400000));
      practiceData.recurrence = { freq, interval, byDays };
      if (endType === 'until' && untilValue) {
        practiceData.recurrence.until = Timestamp.fromDate(new Date(untilValue));
      } else if (endType === 'count') {
        practiceData.recurrence.count = Number.parseInt(String(countValue), 10) || 10;
      }
      if (!editingPracticeId) {
        practiceData.exDates = [];
        practiceData.overrides = {};
      }
      return practiceData;
    }
      ['isSeriesMaster', 'recurrence', 'seriesId', 'startTime', 'endTime', 'endDayOffset', 'exDates', 'overrides'].forEach((fieldName) => {
        if (editingPracticeId) {
          practiceData[fieldName] = deleteField();
        }
      });
      return practiceData;
  }),
  generateSeriesId: vi.fn(() => 'series-generated')
}));

vi.mock('./adapters/legacyAvailability', () => ({
  buildAvailabilityNoteRows: vi.fn(() => []),
  canViewAvailabilityNotes: vi.fn(() => false),
  formatAvailabilityCutoff: vi.fn(() => ''),
  isAvailabilityLocked: vi.fn(() => false),
  normalizeAvailabilityPreferences: vi.fn((value: any) => (value && typeof value === 'object' ? value : {}))
}));
vi.mock('./profileService', () => ({ loadProfileDocument: vi.fn(), saveProfileDocument: vi.fn() }));
vi.mock('./authService', () => ({
  firebaseAuth: { app: { options: { projectId: 'allplays-test' } } },
  getNativeAuthIdToken: vi.fn()
}));
vi.mock('./uxTiming', () => ({ startUxTimer: vi.fn(() => ({ end: vi.fn() })) }));
vi.mock('./chatService', () => ({ sendTeamChatMessage: vi.fn() }));
vi.mock('./chatLogic', () => ({ DEFAULT_TEAM_CONVERSATION_ID: 'team' }));
vi.mock('./appDataCache', () => ({
  getCachedAppData: vi.fn(),
  loadCachedAppData: vi.fn((_key: string, loader: () => Promise<unknown>) => loader()),
  clearAppDataCache: vi.fn(),
  getParentScheduleSummaryCacheKey: (userId: string) => `app-schedule-summary:${userId}`
}));

import { addGame, addPractice, broadcastLiveEvent, buildSingleLegacyTournamentGameDocument, buildLegacyTournamentGameDocument, buildLegacyTournamentGameDocuments, claimOpenOfficiatingSlot, clearOccurrenceOverride, releaseAssignmentClaim, respondToOfficiatingAssignment, updateEvent, updateGame, updateOccurrence, getAssignmentClaims, getGame, getGames, getPlayers, getPracticeSession, getPracticeSessions, getRsvpBreakdownByPlayer, getRsvpSummaries, getRsvps, getTeam, getTeams, listRideOffersForEvent, submitRsvpForPlayer, updatePracticeAttendance, getDoc, getDocs } from './adapters/legacyScheduleDb';
import { getNativeAuthIdToken } from './authService';
import { expandRecurrence, fetchAndParseCalendar, isTeamActive, mergeAssignmentsWithClaims } from './adapters/legacyScheduleHelpers';
import { getCachedAppData, loadCachedAppData } from './appDataCache';
import { mapScheduleEventRecord } from './firestore/mappers';
import { loadProfileDocument } from './profileService';
import { getScheduleTournamentInfo } from './scheduleLogic';
import { adjustGameScore, buildPlayerScoringLiveEvent, buildSingleGameTournamentLegacySchedulePayload, claimOfficialAssignmentItem, createScheduledGameForApp, createScheduledPracticeForApp, createScheduledTournamentBlockForApp, createStaffRsvpAvailabilityLoader, flushPendingLivePublishOperations, hydrateParentScheduleDetails, loadOfficialAssignments, loadParentSchedule, loadParentScheduleChildren, loadParentScheduleEventDetail, loadScheduledPracticeSeriesForEdit, loadStaffPracticeAttendance, loadStaffScheduleRsvpBreakdown, publishLiveScoreUpdateEvent, recordPlayerGameStat, recordPlayerScoringStat, releaseParentScheduleAssignmentClaim, resolveCachedParentScheduleEvents, resolveLiveGameClockSnapshot, resolveParentGameRoute, respondToOfficialAssignmentItem, revertScheduledPracticeOccurrenceForApp, saveScheduledGameLineupDraftForApp, saveStaffPracticeAttendance, submitStaffScheduleRsvpOverride, TournamentBlockPartialSaveError, undoRecordedPlayerGameStat, updateLiveGameClockState, updateScheduledPracticeForApp } from './scheduleService';

function playerSnapshot(id: string, data: Record<string, unknown> | null) {
  return {
    id,
    exists: () => data !== null,
    data: () => data
  };
}

it('keeps schedule workflows behind typed legacy adapters', () => {
  const scheduleServiceSource = readAppSource('lib/scheduleService.ts');
  const scheduleEventDetailSource = readAppSource('pages/ScheduleEventDetail.tsx');

  expect(scheduleServiceSource).not.toContain("../../../../js/");
  expect(scheduleServiceSource).toContain("./adapters/legacyScheduleDb");
  expect(scheduleServiceSource).toContain("./adapters/legacyScheduleHelpers");
  expect(scheduleServiceSource).toContain("./adapters/legacyAvailability");
  expect(scheduleServiceSource).toContain("./statTrackingEvent");
  expect(scheduleServiceSource).not.toContain("from './statTrackingService'");
  expect(scheduleServiceSource).toContain("./logger");
  expect(scheduleServiceSource).toContain("createLogger('schedule-service')");
  expect(scheduleServiceSource).toContain("startUxTimer('parent schedule service load', {");
  expect(scheduleServiceSource).toContain("operation: 'parent-schedule-load'");
  expect(scheduleServiceSource).not.toContain('console.');
  expect(scheduleServiceSource).not.toContain('await Promise.resolve();');
  expect(scheduleServiceSource).toContain('lock.waiters.push(resolve);');
  expect(scheduleEventDetailSource).not.toContain("../../../../js/");
  expect(scheduleEventDetailSource).toContain("../lib/adapters/legacyScheduleHelpers");
});

describe('parent schedule child scope', () => {
  const parentUser = { uid: 'parent-1', email: 'parent@example.com', roles: ['parent'], parentOf: [] } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTeamActive).mockImplementation((team: any) => (
      team?.active !== false &&
      team?.archived !== true &&
      !['archived', 'inactive', 'disabled'].includes(String(team?.status || '').trim().toLowerCase())
    ));
  });

  it('hydrates linked children from profile parentPlayerKeys when auth parentOf is empty', async () => {
    vi.mocked(loadProfileDocument).mockResolvedValue({
      parentOf: [],
      parentTeamIds: ['team-1'],
      parentPlayerKeys: ['team-1::player-1']
    } as any);
    vi.mocked(getTeam).mockResolvedValue({ id: 'team-1', name: 'Bears', active: true } as any);
    vi.mocked(getDoc).mockResolvedValue(playerSnapshot('player-1', { name: 'Avery Lee', active: true }) as any);

    const children = await loadParentScheduleChildren(parentUser);

    expect(children).toEqual([
      { teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Avery Lee' }
    ]);
    expect(getTeam).toHaveBeenCalledWith('team-1');
    expect(getDoc).toHaveBeenCalledWith(expect.objectContaining({ path: 'teams/team-1/players/player-1' }));
    expect(getPlayers).not.toHaveBeenCalled();
  });

  it('loads parent-linked players without requiring a browser window for timeout guards', async () => {
    const previousWindow = (globalThis as any).window;
    delete (globalThis as any).window;
    vi.mocked(loadProfileDocument).mockResolvedValue({
      parentOf: [],
      parentTeamIds: ['team-1'],
      parentPlayerKeys: ['team-1::player-1']
    } as any);
    vi.mocked(getTeam).mockResolvedValue({ id: 'team-1', name: 'Bears', active: true } as any);
    vi.mocked(getDoc).mockResolvedValue(playerSnapshot('player-1', { name: 'Avery Lee', active: true }) as any);

    try {
      await expect(loadParentScheduleChildren(parentUser)).resolves.toEqual([
        { teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Avery Lee' }
      ]);
    } finally {
      if (previousWindow === undefined) {
        delete (globalThis as any).window;
      } else {
        (globalThis as any).window = previousWindow;
      }
    }
  });

  it('filters inactive teams and inactive roster players from parent child links', async () => {
    vi.mocked(loadProfileDocument).mockResolvedValue({
      parentOf: [
        { teamId: 'team-active', playerId: 'player-active', teamName: 'Old Team', playerName: 'Old Player' },
        { teamId: 'team-active', playerId: 'player-inactive', teamName: 'Old Team', playerName: 'Inactive Player' },
        { teamId: 'team-archived', playerId: 'player-archived', teamName: 'Archived Team', playerName: 'Archived Player' }
      ]
    } as any);
    vi.mocked(getTeam).mockImplementation(async (teamId: string) => ({
      'team-active': { id: 'team-active', name: 'Active Team', active: true },
      'team-archived': { id: 'team-archived', name: 'Archived Team', archived: true }
    }[teamId] || null) as any);
    vi.mocked(getDoc).mockImplementation(async (ref: any) => {
      if (ref?.path === 'teams/team-active/players/player-active') {
        return playerSnapshot('player-active', { name: 'Active Player', active: true }) as any;
      }
      if (ref?.path === 'teams/team-active/players/player-inactive') {
        return playerSnapshot('player-inactive', { name: 'Inactive Player', active: false }) as any;
      }
      return playerSnapshot(String(ref?.path || '').split('/').pop() || 'missing', null) as any;
    });

    const children = await loadParentScheduleChildren(parentUser);

    expect(children).toEqual([
      { teamId: 'team-active', teamName: 'Active Team', playerId: 'player-active', playerName: 'Active Player' }
    ]);
    expect(getPlayers).not.toHaveBeenCalled();
  });

  it('filters missing parent-linked players even when legacy metadata exists', async () => {
    vi.mocked(loadProfileDocument).mockResolvedValue({
      parentOf: [
        { teamId: 'team-active', playerId: 'player-missing', teamName: 'Old Team', playerName: 'Missing Player' }
      ]
    } as any);
    vi.mocked(getTeam).mockResolvedValue({ id: 'team-active', name: 'Active Team', active: true } as any);
    vi.mocked(getDoc).mockResolvedValue(playerSnapshot('player-missing', null) as any);

    const children = await loadParentScheduleChildren(parentUser);

    expect(children).toEqual([]);
    expect(getDoc).toHaveBeenCalledWith(expect.objectContaining({ path: 'teams/team-active/players/player-missing' }));
    expect(getPlayers).not.toHaveBeenCalled();
  });

  it('reloads profile scope during schedule enrichment when the fast scope profile is empty', async () => {
    vi.mocked(loadProfileDocument).mockResolvedValue({
      parentOf: [],
      parentPlayerKeys: ['team-1::player-1']
    } as any);
    vi.mocked(getTeam).mockResolvedValue({ id: 'team-1', name: 'Bears', active: true } as any);
    vi.mocked(getDoc).mockResolvedValue(playerSnapshot('player-1', { name: 'Avery Lee', active: true }) as any);
    vi.mocked(getTeams).mockResolvedValue([] as any);
    vi.mocked(getGames).mockResolvedValue([] as any);
    vi.mocked(getPracticeSessions).mockResolvedValue([] as any);

    const schedule = await loadParentSchedule(parentUser, {
      hydrateDetails: false,
      expandStaffPlayers: false,
      parentScope: {
        profile: {},
        children: []
      }
    });

    expect(loadProfileDocument).toHaveBeenCalledWith('parent-1');
    expect(schedule.children).toEqual([
      { teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Avery Lee' }
    ]);
  });
});

describe('scheduled tournament writes', () => {
  const coachUser = { uid: 'coach-1', email: 'coach@example.com', roles: ['coach'] } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTeam).mockResolvedValue({ id: 'team-1', ownerId: 'coach-1', adminEmails: [], admins: [] } as any);
  });

  it('keeps non-tournament scheduled game payloads on the unchanged legacy create shape', async () => {
    vi.mocked(addGame).mockResolvedValueOnce('game-1' as any);

    const createdId = await createScheduledGameForApp('team-1', {
      opponent: 'Tigers',
      startDate: new Date('2026-06-24T18:30:00.000Z'),
      endDate: new Date('2026-06-24T20:00:00.000Z'),
      location: 'Main Gym',
      arrivalTime: new Date('2026-06-24T18:00:00.000Z'),
      isHome: true,
      notes: 'Bring dark jerseys',
      statTrackerConfigId: 'basketball-varsity',
      countsTowardSeasonRecord: true
    }, coachUser);

    expect(createdId).toBe('game-1');
    expect(buildSingleLegacyTournamentGameDocument).not.toHaveBeenCalled();
    expect(buildLegacyTournamentGameDocument).not.toHaveBeenCalled();
    expect(buildLegacyTournamentGameDocuments).not.toHaveBeenCalled();
    expect(addGame).toHaveBeenCalledTimes(1);
    expect(addGame).toHaveBeenCalledWith('team-1', {
      type: 'game',
      date: new Date('2026-06-24T18:30:00.000Z'),
      end: new Date('2026-06-24T20:00:00.000Z'),
      opponent: 'Tigers',
      title: null,
      location: 'Main Gym',
      isHome: true,
      arrivalTime: new Date('2026-06-24T18:00:00.000Z'),
      notes: 'Bring dark jerseys',
      assignments: [],
      status: 'scheduled',
      homeScore: 0,
      awayScore: 0,
      competitionType: 'league',
      countsTowardSeasonRecord: true,
      statTrackerConfigId: 'basketball-varsity',
      opponentTeamId: null,
      opponentTeamName: null,
      opponentTeamPhoto: null,
      createdBy: 'coach-1'
    });
  });

  it('adapts one completed tournament row into a normalized legacy game payload', () => {
    const payload = buildSingleGameTournamentLegacySchedulePayload({
      opponent: '  Tigers  ',
      startDate: new Date('2026-06-24T18:30:00.000Z'),
      endDate: new Date('2026-06-24T20:00:00.000Z'),
      location: '  Main Gym  ',
      arrivalTime: new Date('2026-06-24T18:00:00.000Z'),
      isHome: true,
      notes: '  Bring dark jerseys  ',
      competitionType: 'league'
    }, {
      divisionName: '  10U Gold  ',
      bracketName: '  Gold Bracket  ',
      roundName: '  Semifinal  ',
      poolName: '  Pool A  '
    }, coachUser);

    expect(buildSingleLegacyTournamentGameDocument).toHaveBeenCalledWith([expect.objectContaining({
      type: 'game',
      opponent: 'Tigers',
      location: 'Main Gym',
      notes: 'Bring dark jerseys',
      competitionType: 'tournament',
      createdBy: 'coach-1'
    })], {
      divisionName: '10U Gold',
      bracketName: 'Gold Bracket',
      roundName: 'Semifinal',
      poolName: 'Pool A'
    });
    expect(payload).toEqual(expect.objectContaining({
      type: 'game',
      opponent: 'Tigers',
      competitionType: 'tournament',
      tournament: {
        divisionName: '10U Gold',
        bracketName: 'Gold Bracket',
        roundName: 'Semifinal',
        poolName: 'Pool A'
      }
    }));
    expect(addGame).not.toHaveBeenCalled();
  });

  it('prevalidates every tournament row before building or writing documents', async () => {
    await expect(createScheduledTournamentBlockForApp('team-1', {
      divisionName: '10U Gold',
      bracketName: 'Gold Bracket',
      roundName: 'Semifinal',
      poolName: 'Pool A',
      games: [
        {
          opponent: 'Tigers',
          startDate: new Date('2026-06-24T18:30:00.000Z'),
          endDate: new Date('2026-06-24T20:00:00.000Z'),
          location: 'Main Gym',
          arrivalTime: new Date('2026-06-24T18:00:00.000Z'),
          isHome: true,
          notes: 'Bring dark jerseys'
        },
        {
          opponent: '',
          startDate: new Date('2026-06-25T18:30:00.000Z'),
          endDate: new Date('2026-06-25T20:00:00.000Z'),
          location: 'Field 2',
          arrivalTime: new Date('2026-06-25T18:00:00.000Z'),
          isHome: false,
          notes: ''
        }
      ]
    }, coachUser)).rejects.toThrow('Games require an opponent.');

    expect(buildSingleLegacyTournamentGameDocument).not.toHaveBeenCalled();
    expect(buildLegacyTournamentGameDocuments).not.toHaveBeenCalled();
    expect(addGame).not.toHaveBeenCalled();
  });

  it('routes a single-game tournament block through the scheduled game save flow with one legacy document', async () => {
    const scheduleServiceSource = readAppSource('lib/scheduleService.ts');
    vi.mocked(addGame).mockResolvedValueOnce('game-1' as any);

    const createdIds = await createScheduledTournamentBlockForApp('team-1', {
      divisionName: '10U Gold',
      bracketName: 'Gold Bracket',
      roundName: 'Semifinal',
      poolName: 'Pool A',
      games: [
        {
          opponent: 'Tigers',
          startDate: new Date('2026-06-24T18:30:00.000Z'),
          endDate: new Date('2026-06-24T20:00:00.000Z'),
          location: 'Main Gym',
          arrivalTime: new Date('2026-06-24T18:00:00.000Z'),
          isHome: true,
          notes: 'Bring dark jerseys'
        }
      ]
    }, coachUser);

    expect(createdIds).toEqual(['game-1']);
    expect(buildSingleLegacyTournamentGameDocument).toHaveBeenCalledWith([expect.objectContaining({
      type: 'game',
      opponent: 'Tigers',
      competitionType: 'tournament'
    })], {
      divisionName: '10U Gold',
      bracketName: 'Gold Bracket',
      roundName: 'Semifinal',
      poolName: 'Pool A'
    });
    expect(buildLegacyTournamentGameDocument).not.toHaveBeenCalled();
    expect(buildLegacyTournamentGameDocuments).not.toHaveBeenCalled();
    expect(scheduleServiceSource).toContain('createScheduledGameForApp(normalizedTeamId, games[0], user, {');
    expect(scheduleServiceSource).toContain('legacyPayload,');
    expect(addGame).toHaveBeenCalledTimes(1);
    expect(addGame).toHaveBeenCalledWith('team-1', expect.objectContaining({
      type: 'game',
      opponent: 'Tigers',
      competitionType: 'tournament',
      tournament: {
        divisionName: '10U Gold',
        bracketName: 'Gold Bracket',
        roundName: 'Semifinal',
        poolName: 'Pool A'
      }
    }));
  });

  it('builds and persists every row in a multi-game tournament block', async () => {
    vi.mocked(addGame)
      .mockResolvedValueOnce('game-1' as any)
      .mockResolvedValueOnce('game-2' as any);

    const createdIds = await createScheduledTournamentBlockForApp('team-1', {
      divisionName: '10U Gold',
      bracketName: 'Gold Bracket',
      roundName: 'Semifinal',
      poolName: 'Pool A',
      games: [
        {
          opponent: 'Tigers',
          startDate: new Date('2026-06-24T18:30:00.000Z'),
          endDate: new Date('2026-06-24T20:00:00.000Z'),
          location: 'Main Gym',
          arrivalTime: new Date('2026-06-24T18:00:00.000Z'),
          isHome: true,
          notes: 'Bring dark jerseys'
        },
        {
          opponent: 'Lions',
          startDate: new Date('2026-06-25T18:30:00.000Z'),
          endDate: new Date('2026-06-25T20:00:00.000Z'),
          location: 'Field 2',
          arrivalTime: new Date('2026-06-25T18:00:00.000Z'),
          isHome: false,
          notes: ''
        }
      ]
    }, coachUser);

    expect(createdIds).toEqual(['game-1', 'game-2']);
    expect(buildSingleLegacyTournamentGameDocument).not.toHaveBeenCalled();
    expect(buildLegacyTournamentGameDocuments).toHaveBeenCalledTimes(1);
    expect(buildLegacyTournamentGameDocuments).toHaveBeenCalledWith([
      expect.objectContaining({ opponent: 'Tigers', competitionType: 'tournament', createdBy: 'coach-1' }),
      expect.objectContaining({ opponent: 'Lions', competitionType: 'tournament', createdBy: 'coach-1' })
    ], {
      divisionName: '10U Gold',
      bracketName: 'Gold Bracket',
      roundName: 'Semifinal',
      poolName: 'Pool A'
    });
    expect(addGame).toHaveBeenCalledTimes(2);
    expect(addGame).toHaveBeenNthCalledWith(1, 'team-1', expect.objectContaining({
      opponent: 'Tigers',
      tournament: expect.objectContaining({ bracketName: 'Gold Bracket' })
    }));
    expect(addGame).toHaveBeenNthCalledWith(2, 'team-1', expect.objectContaining({
      opponent: 'Lions',
      tournament: expect.objectContaining({ bracketName: 'Gold Bracket' })
    }));
  });

  it('reports created ids and a safe retry action when a multi-game save is partial', async () => {
    const writeError = new Error('Firestore unavailable');
    vi.mocked(addGame)
      .mockResolvedValueOnce('game-1' as any)
      .mockRejectedValueOnce(writeError);

    const save = createScheduledTournamentBlockForApp('team-1', {
      divisionName: '10U Gold',
      bracketName: 'Gold Bracket',
      roundName: 'Semifinal',
      poolName: 'Pool A',
      games: [
        {
          opponent: 'Tigers',
          startDate: new Date('2026-06-24T18:30:00.000Z'),
          endDate: new Date('2026-06-24T20:00:00.000Z')
        },
        {
          opponent: 'Lions',
          startDate: new Date('2026-06-25T18:30:00.000Z'),
          endDate: new Date('2026-06-25T20:00:00.000Z')
        }
      ]
    }, coachUser);

    await expect(save).rejects.toMatchObject({
      name: 'TournamentBlockPartialSaveError',
      createdIds: ['game-1'],
      totalGames: 2,
      failedGameNumber: 2,
      cause: writeError,
      message: 'Tournament block was only partially created: 1 of 2 games were saved. Refresh Schedule before retrying to avoid duplicate games.'
    } satisfies Partial<TournamentBlockPartialSaveError>);
    expect(addGame).toHaveBeenCalledTimes(2);
  });

  it('throws an explicit error when a single-game tournament save returns no id', async () => {
    vi.mocked(addGame).mockResolvedValueOnce(undefined as any);

    await expect(createScheduledTournamentBlockForApp('team-1', {
      divisionName: '10U Gold',
      bracketName: 'Gold Bracket',
      roundName: 'Semifinal',
      poolName: 'Pool A',
      games: [
        {
          opponent: 'Tigers',
          startDate: new Date('2026-06-24T18:30:00.000Z'),
          endDate: new Date('2026-06-24T20:00:00.000Z'),
          location: 'Main Gym',
          arrivalTime: new Date('2026-06-24T18:00:00.000Z'),
          isHome: true,
          notes: 'Bring dark jerseys'
        }
      ]
    }, coachUser)).rejects.toThrow('Tournament game save failed because no game id was returned.');

    expect(addGame).toHaveBeenCalledTimes(1);
  });

  it('does not fall back to REST when a native single-game tournament save resolves without an id', async () => {
    (globalThis as any).window = { location: { protocol: 'capacitor:' }, setTimeout, clearTimeout } as any;
    (globalThis as any).fetch = vi.fn();
    vi.mocked(addGame).mockResolvedValueOnce(undefined as any);

    await expect(createScheduledTournamentBlockForApp('team-1', {
      divisionName: '10U Gold',
      bracketName: 'Gold Bracket',
      roundName: 'Semifinal',
      poolName: 'Pool A',
      games: [
        {
          opponent: 'Tigers',
          startDate: new Date('2026-06-24T18:30:00.000Z'),
          endDate: new Date('2026-06-24T20:00:00.000Z'),
          location: 'Main Gym',
          arrivalTime: new Date('2026-06-24T18:00:00.000Z'),
          isHome: true,
          notes: 'Bring dark jerseys'
        }
      ]
    }, coachUser)).rejects.toThrow('Tournament game save failed because no game id was returned.');

    expect(addGame).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects tournament blocks without required metadata or child games', async () => {
    await expect(createScheduledTournamentBlockForApp('team-1', {
      divisionName: '',
      bracketName: 'Gold Bracket',
      roundName: 'Semifinal',
      poolName: 'Pool A',
      games: [{ opponent: 'Tigers', startDate: new Date('2026-06-24T18:30:00.000Z') } as any]
    }, coachUser)).rejects.toThrow('Tournament blocks require division, bracket, and round names.');

    await expect(createScheduledTournamentBlockForApp('team-1', {
      divisionName: '10U Gold',
      bracketName: 'Gold Bracket',
      roundName: 'Semifinal',
      poolName: 'Pool A',
      games: []
    }, coachUser)).rejects.toThrow('Tournament blocks require at least one game.');
  });

  it('fails fast on invalid single child games before any tournament writes occur', async () => {
    await expect(createScheduledTournamentBlockForApp('team-1', {
      divisionName: '10U Gold',
      bracketName: 'Gold Bracket',
      roundName: 'Semifinal',
      poolName: 'Pool A',
      games: [
        {
          opponent: '',
          startDate: new Date('2026-06-25T18:30:00.000Z'),
          endDate: new Date('2026-06-25T20:00:00.000Z')
        } as any
      ]
    }, coachUser)).rejects.toThrow('Games require an opponent.');

    await expect(createScheduledTournamentBlockForApp('team-1', {
      divisionName: '10U Gold',
      bracketName: 'Gold Bracket',
      roundName: 'Semifinal',
      poolName: 'Pool A',
      games: [
        {
          opponent: 'Lions',
          startDate: 'not-a-date',
          endDate: new Date('2026-06-25T20:00:00.000Z')
        } as any
      ]
    }, coachUser)).rejects.toThrow('Game start time is invalid.');

    expect(addGame).not.toHaveBeenCalled();
  });
});

describe('scheduled practice writes', () => {
  const coachUser = { uid: 'coach-1', email: 'coach@example.com', roles: ['coach'] } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTeam).mockResolvedValue({ id: 'team-1', ownerId: 'coach-1', adminEmails: [], admins: [] } as any);
  });

  it('creates recurring practice payloads with the legacy recurrence shape', async () => {
    vi.mocked(addPractice).mockResolvedValue('practice-1' as any);
    const { applyPracticeRecurrenceFields: applyLegacyPracticeRecurrenceFields } = await import('../../../../js/edit-schedule-practice-payload.js');

    await createScheduledPracticeForApp('team-1', {
      title: 'Summer Skills',
      startDate: new Date('2026-06-24T18:00:00.000Z'),
      endDate: new Date('2026-06-24T19:30:00.000Z'),
      location: 'Field 3',
      notes: 'Bring pinnies',
      recurrence: {
        isRecurring: true,
        freq: 'weekly',
        interval: 1,
        byDays: ['WE'],
        endType: 'until',
        untilValue: '2026-07-29'
      }
    }, coachUser);

    const expectedPayload: Record<string, unknown> = {
      type: 'practice',
      title: 'Summer Skills',
      date: new Date('2026-06-24T18:00:00.000Z'),
      end: new Date('2026-06-24T19:30:00.000Z'),
      opponent: null,
      location: 'Field 3',
      notes: 'Bring pinnies',
      scheduleNotifications: {},
      status: 'scheduled',
      homeScore: 0,
      awayScore: 0,
      statTrackerConfigId: null,
      createdBy: 'coach-1'
    };
    applyLegacyPracticeRecurrenceFields({
      practiceData: expectedPayload,
      isRecurring: true,
      recurrenceConfig: {
        freq: 'weekly',
        interval: 1,
        byDays: ['WE'],
        endType: 'until',
        untilValue: '2026-07-29',
        countValue: 10
      },
      startDate: new Date('2026-06-24T18:00:00.000Z'),
      endDate: new Date('2026-06-24T19:30:00.000Z'),
      Timestamp: { fromDate: (value: Date) => value },
      deleteField: () => ({ __deleteField: true }),
      generateSeriesId: () => 'series-generated'
    });

    expect(addPractice).toHaveBeenCalledWith('team-1', expectedPayload);
  });

  it('writes single-occurrence practice edits as overrides', async () => {
    await updateScheduledPracticeForApp('team-1', {
      title: 'Special Session',
      startDate: new Date(2026, 5, 24, 17, 15),
      endDate: new Date(2026, 5, 24, 18, 45),
      location: 'Indoor court',
      notes: 'Film first 15 minutes'
    }, coachUser, {
      eventId: 'practice-master__2026-06-24',
      scope: 'occurrence'
    });

    expect(updateOccurrence).toHaveBeenCalledWith('team-1', 'practice-master', '2026-06-24', {
      title: 'Special Session',
      startTime: '17:15',
      endTime: '18:45',
      location: 'Indoor court',
      notes: 'Film first 15 minutes'
    });
  });

  it('quotes Firestore override paths when native occurrence updates fall back to REST', async () => {
    (globalThis as any).window = { location: { protocol: 'capacitor:' }, setTimeout, clearTimeout } as any;
    (globalThis as any).fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as any);
    vi.mocked(getNativeAuthIdToken).mockResolvedValue('native-token' as any);
    vi.mocked(updateOccurrence).mockRejectedValueOnce(new Error('timed out'));

    await updateScheduledPracticeForApp('team-1', {
      title: 'Special Session',
      startDate: new Date(2026, 5, 24, 17, 15),
      endDate: new Date(2026, 5, 24, 18, 45),
      location: 'Indoor court',
      notes: 'Film first 15 minutes'
    }, coachUser, {
      eventId: 'practice-master__2026-06-24',
      scope: 'occurrence'
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(requestInit.body || '{}'));

    expect(requestUrl).toContain('updateMask.fieldPaths=overrides.%602026-06-24%60.title');
    expect(requestUrl).toContain('updateMask.fieldPaths=overrides.%602026-06-24%60.startTime');
    expect(requestInit.method).toBe('PATCH');
    expect(payload.fields.overrides.mapValue.fields['2026-06-24']).toEqual({
      mapValue: {
        fields: {
          title: { stringValue: 'Special Session' },
          startTime: { stringValue: '17:15' },
          endTime: { stringValue: '18:45' },
          location: { stringValue: 'Indoor court' },
          notes: { stringValue: 'Film first 15 minutes' }
        }
      }
    });
    expect(payload.fields.updatedBy).toEqual({ stringValue: 'coach-1' });
    expect(typeof payload.fields.updatedAt.timestampValue).toBe('string');
  });

  it('reverts occurrence overrides without touching the series master', async () => {
    await revertScheduledPracticeOccurrenceForApp('team-1', 'practice-master__2026-06-24', coachUser);
    expect(clearOccurrenceOverride).toHaveBeenCalledWith('team-1', 'practice-master', '2026-06-24');
  });

  it('quotes Firestore override paths when native occurrence reverts fall back to REST', async () => {
    (globalThis as any).window = { location: { protocol: 'capacitor:' }, setTimeout, clearTimeout } as any;
    (globalThis as any).fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as any);
    vi.mocked(getNativeAuthIdToken).mockResolvedValue('native-token' as any);
    vi.mocked(clearOccurrenceOverride).mockRejectedValueOnce(new Error('timed out'));

    await revertScheduledPracticeOccurrenceForApp('team-1', 'practice-master__2026-06-24', coachUser);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(requestInit.body || '{}'));

    expect(requestUrl).toContain('updateMask.fieldPaths=overrides.%602026-06-24%60');
    expect(requestInit.method).toBe('PATCH');
    expect(payload).toEqual({
      fields: {
        updatedAt: { timestampValue: payload.fields.updatedAt.timestampValue },
        updatedBy: { stringValue: 'coach-1' }
      }
    });
    expect(typeof payload.fields.updatedAt.timestampValue).toBe('string');
  });

  it('loads the recurring series master when editing a single occurrence as a series', async () => {
    vi.mocked(getGame).mockResolvedValue({
      id: 'practice-master',
      type: 'practice',
      title: 'Weekly Practice',
      date: new Date('2026-06-17T18:00:00.000Z'),
      end: new Date('2026-06-17T19:30:00.000Z'),
      location: 'Field 2',
      notes: 'Master note',
      seriesId: 'series-1',
      isSeriesMaster: true,
      recurrence: { freq: 'weekly', interval: 1, byDays: ['WE'], count: 8 }
    } as any);

    const result = await loadScheduledPracticeSeriesForEdit('team-1', 'practice-master__2026-06-24', coachUser);

    expect(result).toMatchObject({
      eventId: 'practice-master',
      seriesId: 'series-1',
      input: {
        title: 'Weekly Practice',
        location: 'Field 2',
        notes: 'Master note',
        recurrence: {
          isRecurring: true,
          freq: 'weekly',
          interval: 1,
          byDays: ['WE'],
          endType: 'count',
          countValue: 8
        }
      }
    });
  });

  it('loads recurrence until dates from Firestore Timestamp values', async () => {
    vi.mocked(getGame).mockResolvedValue({
      id: 'practice-master',
      type: 'practice',
      title: 'Weekly Practice',
      date: new Date('2026-06-17T18:00:00.000Z'),
      end: new Date('2026-06-17T19:30:00.000Z'),
      location: 'Field 2',
      notes: 'Master note',
      seriesId: 'series-1',
      isSeriesMaster: true,
      recurrence: {
        freq: 'weekly',
        interval: 1,
        byDays: ['WE'],
        until: { toDate: () => new Date('2026-07-29T00:00:00.000Z') }
      }
    } as any);

    const result = await loadScheduledPracticeSeriesForEdit('team-1', 'practice-master__2026-06-24', coachUser);

    expect(result.input.recurrence).toMatchObject({
      endType: 'until',
      untilValue: '2026-07-29'
    });
  });

  it('removes recurrence fields when a series is converted back to one-off', async () => {
    await updateScheduledPracticeForApp('team-1', {
      title: 'One-off practice',
      startDate: new Date('2026-06-24T18:00:00.000Z'),
      endDate: new Date('2026-06-24T19:30:00.000Z'),
      location: 'Field 3',
      notes: 'No recurrence',
      recurrence: { isRecurring: false }
    }, coachUser, {
      eventId: 'practice-master',
      seriesId: 'series-1',
      scope: 'series'
    });

    expect(updateEvent).toHaveBeenCalledWith('team-1', 'practice-master', expect.objectContaining({
      isSeriesMaster: { __deleteField: true },
      recurrence: { __deleteField: true },
      seriesId: { __deleteField: true },
      overrides: { __deleteField: true },
      exDates: { __deleteField: true }
    }));
  });

  it('does not rewrite existing recurrence exDates and overrides on series edits', async () => {
    const today = new Date();
    today.setHours(18, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const dayAfterTomorrow = new Date(today);
    dayAfterTomorrow.setDate(today.getDate() + 2);
    const excludedDate = tomorrow.toISOString().slice(0, 10);
    const overrideDate = dayAfterTomorrow.toISOString().slice(0, 10);

    const existingMaster = {
      id: 'practice-master',
      type: 'practice',
      title: 'Weekly Practice',
      date: new Date(today),
      end: new Date(today.getTime() + 90 * 60000),
      location: 'Field 2',
      notes: 'Master note',
      seriesId: 'series-1',
      isSeriesMaster: true,
      recurrence: { freq: 'daily', interval: 1, count: 5 },
      startTime: '18:00',
      endTime: '19:30',
      endDayOffset: 0,
      exDates: [excludedDate],
      overrides: {
        [overrideDate]: {
          title: 'Adjusted Practice',
          location: 'South Field'
        }
      }
    };
    await updateScheduledPracticeForApp('team-1', {
      title: 'Updated Practice',
      startDate: new Date(today),
      endDate: new Date(today.getTime() + 105 * 60000),
      location: 'North Field',
      notes: 'Bring water',
      recurrence: {
        isRecurring: true,
        freq: 'daily',
        interval: 1,
        byDays: [],
        endType: 'count',
        countValue: 5
      }
    }, coachUser, {
      eventId: 'practice-master',
      seriesId: 'series-1',
      scope: 'series'
    });

    expect(getGame).not.toHaveBeenCalled();

    const updateEventCalls = vi.mocked(updateEvent).mock.calls;
    const [, , payload] = updateEventCalls[updateEventCalls.length - 1] as [string, string, Record<string, unknown>];
    const { expandRecurrence: actualExpandRecurrence } = await import('../../../../js/utils.js');
    expect(payload).not.toHaveProperty('exDates');
    expect(payload).not.toHaveProperty('overrides');

    const expanded = actualExpandRecurrence({
      ...existingMaster,
      ...payload
    }, 10);

    expect(expanded.map((item: any) => item.instanceDate)).not.toContain(excludedDate);
    expect(expanded.find((item: any) => item.instanceDate === overrideDate)).toMatchObject({
      title: 'Adjusted Practice',
      location: 'South Field',
      isModified: true
    });
    expect(expanded.find((item: any) => item.instanceDate === today.toISOString().slice(0, 10))).toMatchObject({
      title: 'Updated Practice',
      location: 'North Field'
    });
  });
});

describe('parent game route resolution', () => {
  beforeEach(() => {
    (globalThis as any).window = globalThis as any;
    vi.clearAllMocks();
    vi.mocked(loadProfileDocument).mockResolvedValue({
      parentOf: [
        { teamId: 'team-alpha', playerId: 'child-1', playerName: 'Avery' },
        { teamId: 'team-bravo', playerId: 'child-2', playerName: 'Blake' }
      ]
    } as any);
    vi.mocked(getTeams).mockResolvedValue([] as any);
    vi.mocked(getDoc).mockImplementation(async (ref: any) => {
      const playerId = String(ref?.path || '').split('/').pop() || '';
      return playerSnapshot(playerId, { id: playerId, name: playerId === 'child-2' ? 'Blake' : 'Avery', active: true }) as any;
    });
    vi.mocked(getGame).mockImplementation(async (teamId: string, gameId: string) => {
      if (teamId === 'team-bravo' && gameId === 'game-7') {
        return { id: 'game-7', type: 'game', date: new Date('2026-06-25T18:00:00.000Z') } as any;
      }
      return null as any;
    });
    vi.mocked(getCachedAppData).mockReturnValue(null);
    vi.mocked(getGames).mockResolvedValue([] as any);
    vi.mocked(getPracticeSessions).mockResolvedValue([] as any);
    vi.mocked(fetchAndParseCalendar).mockResolvedValue([] as any);
  });

  it('resolves a game route from the cached schedule summary before scanning teams', async () => {
    vi.mocked(getCachedAppData).mockReturnValue({
      children: [],
      events: [
        {
          id: 'game-7',
          teamId: 'team-bravo',
          type: 'game',
          childId: 'child-2'
        }
      ]
    } as any);

    const result = await resolveParentGameRoute({ uid: 'parent-1', email: 'parent@example.com', roles: [] } as any, 'game-7', {
      expandStaffPlayers: false
    });

    expect(result).toEqual({
      teamId: 'team-bravo',
      eventId: 'game-7',
      childId: 'child-2',
      cachedEvent: expect.objectContaining({
        id: 'game-7',
        teamId: 'team-bravo',
        childId: 'child-2'
      })
    });
    expect(getCachedAppData).toHaveBeenCalledWith('app-schedule-summary:parent-1');
    expect(loadProfileDocument).not.toHaveBeenCalled();
    expect(getGame).not.toHaveBeenCalled();
    expect(getGames).not.toHaveBeenCalled();
    expect(getPracticeSessions).not.toHaveBeenCalled();
    expect(fetchAndParseCalendar).not.toHaveBeenCalled();
  });

  it('resolves a game route without loading full schedules or calendars when cache misses', async () => {
    const result = await resolveParentGameRoute({ uid: 'parent-1', email: 'parent@example.com', roles: [] } as any, 'game-7', {
      expandStaffPlayers: false
    });

    expect(result).toEqual({
      teamId: 'team-bravo',
      eventId: 'game-7',
      childId: 'child-2'
    });
    expect(getGame).toHaveBeenCalledWith('team-alpha', 'game-7');
    expect(getGame).toHaveBeenCalledWith('team-bravo', 'game-7');
    expect(getGames).not.toHaveBeenCalled();
    expect(getPracticeSessions).not.toHaveBeenCalled();
    expect(fetchAndParseCalendar).not.toHaveBeenCalled();
  });
});

describe('parent schedule detail hydration', () => {
  const user = { uid: 'parent-1', email: 'parent@example.com', roles: [] } as any;

  function buildHydrationEvent(id: string, date: Date) {
    return {
      id,
      teamId: 'team-1',
      teamName: 'Bears',
      type: 'game',
      date,
      location: 'Main Gym',
      childId: 'player-1',
      childName: 'Avery',
      isDbGame: true,
      isCancelled: false,
      assignments: [],
      openAssignmentCount: 0,
      availabilityPreferences: {},
      myRsvp: 'not_responded',
      myRsvpNote: null,
      rsvpSummary: null,
      rideshareSummary: null,
      availabilityNotes: []
    } as any;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadCachedAppData).mockImplementation((_key: string, loader: () => Promise<unknown>) => loader());
    vi.mocked(getRsvpSummaries).mockResolvedValue(new Map() as any);
    vi.mocked(getRsvps).mockResolvedValue([
      { id: 'parent-1__player-1', userId: 'parent-1', playerId: 'player-1', response: 'going' }
    ] as any);
    vi.mocked(getDoc).mockImplementation(async (ref: any) => {
      if (String(ref?.path || '').endsWith('/rsvpNotes/parent-1__player-1')) {
        return playerSnapshot('parent-1__player-1', {
          userId: 'parent-1',
          playerIds: ['player-1'],
          note: 'Will be there.'
        }) as any;
      }
      return playerSnapshot('', null) as any;
    });
    vi.mocked(listRideOffersForEvent).mockResolvedValue([] as any);
    vi.mocked(getAssignmentClaims).mockResolvedValue({} as any);
    vi.mocked(mergeAssignmentsWithClaims).mockImplementation((assignments: any[]) => assignments);
  });

  it('eagerly hydrates only near-term Home events without preloading duplicate RSVP summaries', async () => {
    const nearEvent = buildHydrationEvent('near-game', new Date(Date.now() + 24 * 60 * 60 * 1000));
    const futureEvent = buildHydrationEvent('future-game', new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));

    await hydrateParentScheduleDetails({ children: [], events: [nearEvent, futureEvent] }, user);

    expect(getRsvpSummaries).not.toHaveBeenCalled();
    expect(getRsvps).toHaveBeenCalledWith('team-1', 'near-game');
    expect(getRsvps).not.toHaveBeenCalledWith('team-1', 'future-game');
    expect(nearEvent.myRsvp).toBe('going');
    expect(nearEvent.myRsvpNote).toBe('Will be there.');
    expect(nearEvent.rsvpSummary).toEqual({
      going: 1,
      maybe: 0,
      notGoing: 0,
      notResponded: 0,
      total: 1
    });
    expect(futureEvent.myRsvp).toBe('not_responded');
  });

  it('refreshes cached open assignment counts after assignment claim hydration', async () => {
    const nearEvent = buildHydrationEvent('near-game', new Date(Date.now() + 24 * 60 * 60 * 1000));
    nearEvent.assignments = [{ role: 'Scoreboard', claimable: true, value: '' }];
    nearEvent.openAssignmentCount = 1;
    const claimedAssignments = [{ role: 'Scoreboard', claimable: true, value: '', claim: { claimedByUserId: 'parent-2' } }];
    vi.mocked(getAssignmentClaims).mockResolvedValue({ scoreboard: { claimedByUserId: 'parent-2' } } as any);
    vi.mocked(mergeAssignmentsWithClaims).mockReturnValue(claimedAssignments as any);

    await hydrateParentScheduleDetails({ children: [], events: [nearEvent] }, user);

    expect(mergeAssignmentsWithClaims).toHaveBeenCalledWith(
      [{ role: 'Scoreboard', claimable: true, value: '' }],
      { scoreboard: { claimedByUserId: 'parent-2' } }
    );
    expect(nearEvent.assignments).toBe(claimedAssignments);
    expect(nearEvent.openAssignmentCount).toBe(0);
  });

  it('preserves denormalized RSVP summaries without preloading duplicate summaries', async () => {
    const nearEvent = buildHydrationEvent('near-game', new Date(Date.now() + 24 * 60 * 60 * 1000));
    nearEvent.rsvpSummary = {
      going: 8,
      maybe: 1,
      notGoing: 2,
      notResponded: 3,
      total: 14
    };

    await hydrateParentScheduleDetails({ children: [], events: [nearEvent] }, user);

    expect(getRsvpSummaries).not.toHaveBeenCalled();
    expect(getRsvps).toHaveBeenCalledWith('team-1', 'near-game');
    expect(nearEvent.rsvpSummary).toEqual({
      going: 8,
      maybe: 1,
      notGoing: 2,
      notResponded: 3,
      total: 14
    });
  });

  it('reuses cached per-event hydration details across repeated Home hydration passes', async () => {
    const cached = new Map<string, Promise<unknown>>();
    vi.mocked(loadCachedAppData).mockImplementation((key: string, loader: () => Promise<unknown>) => {
      if (!cached.has(key)) {
        cached.set(key, loader());
      }
      return cached.get(key) as Promise<unknown>;
    });

    await hydrateParentScheduleDetails({
      children: [],
      events: [buildHydrationEvent('game-1', new Date(Date.now() + 24 * 60 * 60 * 1000))]
    }, user);
    await hydrateParentScheduleDetails({
      children: [],
      events: [buildHydrationEvent('game-1', new Date(Date.now() + 24 * 60 * 60 * 1000))]
    }, user);

    expect(loadCachedAppData).toHaveBeenCalledWith(
      'event-details:team-1:game-1',
      expect.any(Function),
      expect.objectContaining({ persist: false, ttlMs: 30000 })
    );
    expect(getRsvps).toHaveBeenCalledTimes(1);
    expect(listRideOffersForEvent).toHaveBeenCalledTimes(1);
    expect(getAssignmentClaims).toHaveBeenCalledTimes(1);
  });
});

describe('official assignments app service', () => {
  const user = { uid: 'official-user', email: 'REF@Example.com', displayName: 'Riley Ref', roles: [] } as any;
  const futureDate = new Date(Date.now() + 86400000).toISOString();
  const pastDate = new Date(Date.now() - 86400000).toISOString();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadProfileDocument).mockResolvedValue({ parentTeamIds: ['team-alpha'], phone: '(555) 123-4567' } as any);
    vi.mocked(getDocs).mockImplementation(async (request: any) => {
      const filter = request?.filters?.[0];
      if (filter?.field === 'email' && filter?.value === 'ref@example.com') {
        return { docs: [{ ref: { path: 'teams/team-alpha/officials/ref-1' } }] } as any;
      }
      if (filter?.field === 'phone' && filter?.value === '5551234567') {
        return { docs: [{ ref: { path: 'teams/team-alpha/officials/ref-1' } }] } as any;
      }
      return { docs: [] } as any;
    });
    vi.mocked(getTeam).mockResolvedValue({ id: 'team-alpha', name: 'Alpha FC', ownerId: 'coach-1', adminEmails: [] } as any);
    vi.mocked(getGames).mockResolvedValue([
      {
        id: 'game-assigned',
        date: futureDate,
        opponent: 'Tigers',
        location: 'Field 2',
        officiatingSelfAssignmentEnabled: true,
        officiatingSlots: [
          { id: 'center', position: 'Center Referee', officialEmail: 'ref@example.com', status: 'pending' },
          { id: 'line', position: 'Line Judge', status: 'open' }
        ]
      },
      {
        id: 'game-past',
        date: pastDate,
        opponent: 'Past',
        location: 'Old Field',
        officiatingSlots: [{ id: 'past', position: 'Center Referee', officialEmail: 'ref@example.com', status: 'pending' }]
      },
      {
        id: 'game-cancelled',
        date: futureDate,
        status: 'cancelled',
        opponent: 'Cancelled',
        location: 'Field 9',
        officiatingSlots: [{ id: 'cancelled', position: 'Center Referee', officialEmail: 'ref@example.com', status: 'pending' }]
      }
    ] as any);
  });

  it('loads upcoming assigned and eligible open slots from linked official teams', async () => {
    const result = await loadOfficialAssignments(user);

    expect(result.hasAccess).toBe(true);
    expect(result.teamIds).toEqual(['team-alpha']);
    expect(result.assignments).toEqual([
      expect.objectContaining({
        kind: 'assigned',
        teamId: 'team-alpha',
        teamName: 'Alpha FC',
        gameId: 'game-assigned',
        slotId: 'center',
        position: 'Center Referee',
        status: 'pending',
        opponent: 'Tigers',
        location: 'Field 2',
        canClaim: false
      }),
      expect.objectContaining({
        kind: 'open',
        teamId: 'team-alpha',
        gameId: 'game-assigned',
        slotId: 'line',
        position: 'Line Judge',
        status: 'open',
        canClaim: true
      })
    ]);
    expect(result.assignments.map((item) => item.gameId)).not.toContain('game-past');
    expect(result.assignments.map((item) => item.gameId)).not.toContain('game-cancelled');
    // Regression for #3420: the officials load must bound the game read by date instead
    // of scanning the full games collection. The start date is a small look-behind so
    // same-day / in-progress games stay in range.
    expect(getGames).toHaveBeenCalledWith('team-alpha', { startDate: expect.any(Date) });
    const [, range] = vi.mocked(getGames).mock.calls[0] as [string, { startDate: Date }];
    expect(range.startDate).toBeInstanceOf(Date);
    expect(range.startDate.getTime()).toBeLessThanOrEqual(Date.now());
    expect(range.startDate.getTime()).toBeGreaterThan(Date.now() - 48 * 60 * 60 * 1000);
  });

  it('hides officials access when no official link matches the signed-in user', async () => {
    vi.mocked(getDocs).mockResolvedValue({ docs: [] } as any);

    const result = await loadOfficialAssignments(user);

    expect(result).toEqual({ hasAccess: false, teamIds: [], teamCount: 0, assignments: [] });
    expect(getTeam).not.toHaveBeenCalled();
    expect(getGames).not.toHaveBeenCalled();
  });

  it('loads assigned slots for a requested team when official directory queries are denied', async () => {
    vi.mocked(loadProfileDocument).mockResolvedValue({ parentTeamIds: [], phone: '(555) 123-4567' } as any);
    vi.mocked(getDocs).mockRejectedValue(new Error('Missing or insufficient permissions.'));

    const result = await loadOfficialAssignments(user, { teamId: 'team-alpha' });

    expect(result.hasAccess).toBe(true);
    expect(result.teamIds).toEqual(['team-alpha']);
    expect(result.assignments).toEqual([
      expect.objectContaining({
        kind: 'assigned',
        teamId: 'team-alpha',
        gameId: 'game-assigned',
        slotId: 'center',
        position: 'Center Referee',
        canClaim: false
      })
    ]);
    expect(result.assignments.map((item) => item.kind)).toEqual(['assigned']);
    expect(getTeam).toHaveBeenCalledWith('team-alpha', { includeInactive: true });
    expect(getGames).toHaveBeenCalledWith('team-alpha', { startDate: expect.any(Date) });
  });

  it('delegates accept, decline, and claim writes to legacy officiating actions', async () => {
    const item = {
      kind: 'assigned',
      teamId: 'team-alpha',
      teamName: 'Alpha FC',
      gameId: 'game-assigned',
      slotId: 'center',
      position: 'Center Referee',
      status: 'pending',
      opponent: 'Tigers',
      location: 'Field 2',
      date: new Date(futureDate),
      canClaim: false,
      scheduleReviewRequired: false
    } as any;

    await respondToOfficialAssignmentItem(item, 'accepted');
    await respondToOfficialAssignmentItem(item, 'declined');
    await claimOfficialAssignmentItem({ ...item, kind: 'open', slotId: 'line', canClaim: true }, user);

    expect(respondToOfficiatingAssignment).toHaveBeenNthCalledWith(1, 'team-alpha', 'game-assigned', 'center', 'accepted');
    expect(respondToOfficiatingAssignment).toHaveBeenNthCalledWith(2, 'team-alpha', 'game-assigned', 'center', 'declined');
    expect(claimOpenOfficiatingSlot).toHaveBeenCalledWith('team-alpha', 'game-assigned', 'line', user);
  });
});

it('releases parent assignment claims through the legacy adapter using the active auth user contract', async () => {
  await releaseParentScheduleAssignmentClaim({
    id: 'game-assigned',
    teamId: 'team-alpha',
    type: 'game',
    isDbGame: true,
    isCancelled: false,
    assignments: [{ role: 'Team Snack' }]
  } as any, 'Team Snack');

  expect(releaseAssignmentClaim).toHaveBeenCalledWith('team-alpha', 'game-assigned', 'Team Snack');
});

describe('live game clock state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('restores running clocks from persisted wall-clock anchors', () => {
    const snapshot = resolveLiveGameClockSnapshot({
      liveClockMs: 120000,
      liveClockRunning: true,
      liveClockPeriod: 'Q2',
      liveClockUpdatedAt: new Date('2026-06-12T04:00:00.000Z')
    }, new Date('2026-06-12T04:00:15.000Z'));

    expect(snapshot).toMatchObject({
      persistedClockMs: 120000,
      effectiveClockMs: 135000,
      running: true,
      period: 'Q2'
    });
  });

  it('persists live clock anchors with the active period', async () => {
    vi.mocked(updateGame).mockResolvedValue(undefined as any);

    const payload = await updateLiveGameClockState('team-1', 'game-1', {
      liveClockMs: 135432,
      liveClockRunning: true,
      liveClockPeriod: 'Q2',
      currentGame: { liveStatus: 'scheduled' }
    }, { uid: 'coach-1', email: 'coach@example.com' } as any);

    expect(updateGame).toHaveBeenCalledWith('team-1', 'game-1', expect.objectContaining({
      liveClockMs: 135432,
      liveClockRunning: true,
      liveClockPeriod: 'Q2',
      period: 'Q2',
      liveStatus: 'live',
      liveHasData: true
    }));
    expect(payload).toEqual(expect.objectContaining({
      liveClockMs: 135432,
      liveClockRunning: true,
      liveClockPeriod: 'Q2',
      period: 'Q2'
    }));
  });

  it('rejects live clock updates for games whose scheduled date is long past (#2022)', async () => {
    await expect(updateLiveGameClockState('team-1', 'game-1', {
      liveClockMs: 135432,
      liveClockRunning: true,
      liveClockPeriod: 'Q2',
      currentGame: {
        liveStatus: 'scheduled',
        date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
      }
    }, { uid: 'coach-1', email: 'coach@example.com' } as any)).rejects.toThrow('past games');

    expect(updateGame).not.toHaveBeenCalled();
  });

  it('stamps live score events with the resumed running game clock', async () => {
    (globalThis as any).window = { location: { protocol: 'https:' }, setTimeout, clearTimeout } as any;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T04:00:15.000Z'));
    mocks.transactionGet.mockReset();
    mocks.transactionGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        liveClockMs: 120000,
        liveClockRunning: true,
        liveClockPeriod: 'Q2',
        liveClockUpdatedAt: new Date('2026-06-12T04:00:00.000Z')
      })
    });

    await publishLiveScoreUpdateEvent('team-1', 'game-1', { homeScore: 12, awayScore: 8 }, { uid: 'coach-1', displayName: 'Coach' } as any);

    expect(mocks.transactionSet).toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringContaining('teams/team-1/games/game-1/liveEvents/') }), expect.objectContaining({
      period: 'Q2',
      gameClockMs: 135000
    }));
  });
});

describe('live score publishing', () => {
  const user = { uid: 'coach-1', displayName: 'Coach', email: 'coach@example.com', roles: [] };

  beforeEach(() => {
    (globalThis as any).window = { location: { protocol: 'https:' }, setTimeout, clearTimeout } as any;
    vi.clearAllMocks();
    mocks.transactionGet.mockReset();
    mocks.transactionGet.mockResolvedValue({
      exists: () => true,
      data: () => ({ id: 'game-1', status: 'scheduled', liveStatus: 'scheduled', liveHasData: false, period: 'Q2', liveClockMs: 321000 })
    });
  });

  it('writes the game score and live event in the same transaction', async () => {
    const result = await publishLiveScoreUpdateEvent('team-1', 'game-1', { homeScore: 12, awayScore: 8 }, user, { homeScore: 10, awayScore: 8 });

    expect(mocks.transactionSet).toHaveBeenCalledWith(expect.objectContaining({ path: 'teams/team-1/games/game-1' }), expect.objectContaining({
      homeScore: 12,
      awayScore: 8,
      liveStatus: 'live',
      liveHasData: true,
      liveStartedAt: expect.any(Date)
    }), { merge: true });
    expect(mocks.transactionSet).toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringContaining('teams/team-1/games/game-1/liveEvents/') }), expect.objectContaining({
      eventId: expect.stringMatching(/^app-live-/),
      type: 'score_update',
      period: 'Q2',
      gameClockMs: 321000,
      homeScore: 12,
      awayScore: 8,
      previousHomeScore: 10,
      previousAwayScore: 8
    }));
    expect(result).toMatchObject({
      type: 'score_update',
      homeScore: 12,
      awayScore: 8,
      previousHomeScore: 10,
      previousAwayScore: 8,
      createdBy: 'coach-1',
      createdByName: 'Coach',
      period: 'Q2',
      gameClockMs: 321000
    });
  });

  it('keeps the persisted live score when tracker totals are partial', async () => {
    vi.mocked(getDocs).mockResolvedValue({
      docs: [
        {
          id: 'tracker-1',
          data: () => ({
            undoData: {
              type: 'stat',
              statKey: 'pts',
              value: 2,
              isOpponent: false
            }
          })
        }
      ]
    } as any);
    mocks.transactionGet.mockReset();
    mocks.transactionGet
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ homeScore: 10, awayScore: 8, period: 'Q3', liveClockMs: 245000 })
      })
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ stats: { pts: 4 } }) });

    const result = await recordPlayerGameStat('team-1', 'game-1', 'player-1', {
      statKey: 'pts',
      value: 2,
      playerName: 'Avery Smith',
      playerNumber: '12'
    }, { uid: 'coach-1', displayName: '', email: 'coach@example.com', roles: [] });

    expect(result).toMatchObject({
      homeScore: 12,
      awayScore: 8,
      playerStatTotal: 6
    });
    expect(mocks.transactionSet).toHaveBeenCalledWith(expect.objectContaining({ path: 'teams/team-1/games/game-1' }), expect.objectContaining({
      homeScore: 12,
      awayScore: 8
    }), { merge: true });
  });

  it('rejects score broadcasts after the game is final', async () => {
    mocks.transactionGet.mockReset();
    mocks.transactionGet.mockResolvedValueOnce({ exists: () => true, data: () => ({ id: 'game-1', status: 'completed', liveStatus: 'completed' }) });

    await expect(publishLiveScoreUpdateEvent('team-1', 'game-1', { homeScore: 12, awayScore: 8 }, user)).rejects.toThrow('game is final');
    expect(mocks.transactionSet).not.toHaveBeenCalled();
  });

  it('rejects live score broadcasts for games whose scheduled date is long past (#2022)', async () => {
    mocks.transactionGet.mockReset();
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    mocks.transactionGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ id: 'game-1', status: 'scheduled', liveStatus: 'scheduled', date: fiveDaysAgo })
    });

    await expect(publishLiveScoreUpdateEvent('team-1', 'game-1', { homeScore: 12, awayScore: 8 }, user)).rejects.toThrow('past games');
    expect(mocks.transactionSet).not.toHaveBeenCalled();
  });

  it('allows live score broadcasts for a game scheduled today', async () => {
    mocks.transactionGet.mockReset();
    mocks.transactionGet.mockResolvedValue({
      exists: () => true,
      data: () => ({ id: 'game-1', status: 'scheduled', liveStatus: 'scheduled', date: new Date(), liveHasData: false, period: 'Q1' })
    });

    await expect(publishLiveScoreUpdateEvent('team-1', 'game-1', { homeScore: 5, awayScore: 3 }, user)).resolves.toBeDefined();
    expect(mocks.transactionSet).toHaveBeenCalled();
  });
});

describe('native live publishing fallbacks', () => {
  const user = { uid: 'coach-1', displayName: '', email: 'coach@example.com', roles: [] };
  let localStorageState: Record<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageState = {};
    (globalThis as any).window = {
      location: { protocol: 'capacitor:' },
      setTimeout,
      clearTimeout,
      localStorage: {
        getItem: vi.fn((key: string) => (Object.prototype.hasOwnProperty.call(localStorageState, key) ? localStorageState[key] : null)),
        setItem: vi.fn((key: string, value: string) => {
          localStorageState[key] = String(value);
        }),
        removeItem: vi.fn((key: string) => {
          delete localStorageState[key];
        })
      }
    } as any;
    (globalThis as any).fetch = vi.fn();
    vi.mocked(getNativeAuthIdToken).mockResolvedValue('native-token' as any);
  });

  it('publishes native live score updates from mapped Firestore documents', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: 'projects/allplays-test/databases/(default)/documents/teams/team-1/games/game-1',
          updateTime: '2026-06-19T16:00:00.000Z',
          fields: {
            status: { stringValue: 'scheduled' },
            homeScore: { integerValue: '9' },
            awayScore: { integerValue: '7' },
            period: { stringValue: 'Q2' },
            liveClockMs: { integerValue: '321000' }
          }
        })
      } as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) } as any);

    const result = await publishLiveScoreUpdateEvent('team-1', 'game-1', { homeScore: 12, awayScore: 8 }, user as any);

    expect(result).toMatchObject({
      homeScore: 12,
      awayScore: 8,
      previousHomeScore: 9,
      previousAwayScore: 7,
      createdByName: 'coach@example.com',
      period: 'Q2',
      gameClockMs: 321000
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('records native player stats from mapped Firestore documents', async () => {
    mocks.runTransactionMock.mockRejectedValueOnce(new Error('native fallback'));
    vi.mocked(globalThis.fetch).mockImplementation(async (input: any) => {
      const url = String(input || '');
      if (url.includes('/events')) {
        return { ok: true, json: async () => ({ documents: [] }) } as any;
      }
      if (url.includes('/aggregatedStats/player-1')) {
        return {
          ok: true,
          json: async () => ({
            name: 'projects/allplays-test/databases/(default)/documents/teams/team-1/games/game-1/aggregatedStats/player-1',
            updateTime: '2026-06-19T16:00:00.000Z',
            fields: {
              stats: {
                mapValue: {
                  fields: {
                    pts: { integerValue: '4' }
                  }
                }
              }
            }
          })
        } as any;
      }
      if (url.includes(':commit')) {
        return { ok: true, json: async () => ({}) } as any;
      }
      return {
        ok: true,
        json: async () => ({
          name: 'projects/allplays-test/databases/(default)/documents/teams/team-1/games/game-1',
          updateTime: '2026-06-19T16:00:00.000Z',
          fields: {
            status: { stringValue: 'scheduled' },
            homeScore: { integerValue: '10' },
            awayScore: { integerValue: '8' },
            period: { stringValue: 'Q3' },
            liveClockMs: { integerValue: '245000' }
          }
        })
      } as any;
    });

    const result = await recordPlayerGameStat('team-1', 'game-1', 'player-1', {
      statKey: 'pts',
      value: 2,
      playerName: 'Avery Smith',
      playerNumber: '12'
    }, user as any);

    expect(result).toMatchObject({
      playerId: 'player-1',
      statKey: 'pts',
      value: 2,
      liveEvent: expect.objectContaining({
        type: 'stat',
        playerId: 'player-1',
        statKey: 'pts',
        value: 2
      })
    });
    expect(globalThis.fetch).toHaveBeenCalled();
  });

  it('keeps only failed queued publishes after a partial flush', async () => {
    const queue = [
      {
        id: 'pending-score-1',
        kind: 'score_update',
        teamId: 'team-1',
        gameId: 'game-1',
        score: { homeScore: 11, awayScore: 8 },
        user: { uid: 'coach-1', displayName: 'Coach', email: 'coach@example.com' },
        createdAt: '2026-06-19T16:00:00.000Z'
      },
      {
        id: 'pending-score-2',
        kind: 'score_update',
        teamId: 'team-1',
        gameId: 'game-1',
        score: { homeScore: 13, awayScore: 8 },
        user: { uid: 'coach-1', displayName: 'Coach', email: 'coach@example.com' },
        createdAt: '2026-06-19T16:00:01.000Z'
      }
    ] as any;
    const processor = vi.fn(async (operation: any) => {
      if (operation.id === 'pending-score-1') {
        const error = new Error('server validation failed') as Error & { status?: number };
        error.status = 500;
        throw error;
      }
    });

    const remaining = await flushPendingLivePublishOperations(queue, processor);

    expect(processor).toHaveBeenCalledTimes(2);
    expect(remaining).toEqual([
      expect.objectContaining({ id: 'pending-score-1', kind: 'score_update' })
    ]);
  });
});

describe('player-attributed live scoring', () => {
  beforeEach(() => {
    (globalThis as any).window = { location: { protocol: 'https:' }, setTimeout, clearTimeout } as any;
    vi.clearAllMocks();
    mocks.transactionGet
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ homeScore: 10, awayScore: 8, period: 'Q3', liveClockMs: 245000 }) })
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ stats: { pts: 4, reb: 1 } }) });
  });

  it('builds a player-attributed +2 live event payload', () => {
    const event = buildPlayerScoringLiveEvent({
      playerId: 'player-1',
      playerName: 'Avery Smith',
      playerNumber: '12',
      statKey: 'pts',
      value: 2,
      homeScore: 14,
      awayScore: 8,
      user: { uid: 'coach-1', displayName: 'Coach', email: 'coach@example.com', roles: [] }
    });

    expect(event).toMatchObject({
      eventId: expect.stringMatching(/^app-live-/),
      type: 'stat',
      period: null,
      gameClockMs: 0,
      playerId: 'player-1',
      playerName: 'Avery Smith',
      playerNumber: '12',
      statKey: 'pts',
      value: 2,
      isOpponent: false,
      homeScore: 14,
      awayScore: 8,
      createdBy: 'coach-1',
      createdByName: 'Coach'
    });
    expect(String(event.description)).toContain('#12 Avery Smith scored 2 points');
  });

  it('increments home score and player pts without changing away score', async () => {
    const result = await recordPlayerScoringStat('team-1', 'game-1', 'player-1', {
      statKey: 'pts',
      value: 2,
      playerName: 'Avery Smith',
      playerNumber: '12'
    }, { uid: 'coach-1', displayName: '', email: 'coach@example.com', roles: [] });

    expect(result).toMatchObject({
      homeScore: 12,
      awayScore: 8,
      playerId: 'player-1',
      statKey: 'pts',
      value: 2,
      playerPoints: 6
    });
    expect(mocks.transactionSet).toHaveBeenCalledWith(expect.objectContaining({ path: 'teams/team-1/games/game-1' }), expect.objectContaining({
      homeScore: 12,
      awayScore: 8,
      liveStatus: 'live',
      liveHasData: true,
      liveStartedAt: expect.any(Date)
    }), { merge: true });
    expect(mocks.transactionSet).toHaveBeenCalledWith(expect.objectContaining({ path: 'teams/team-1/games/game-1/aggregatedStats/player-1' }), expect.objectContaining({
      playerName: 'Avery Smith',
      playerNumber: '12',
      stats: { pts: { __increment: 2 } }
    }), { merge: true });
    expect(mocks.transactionSet).toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringContaining('teams/team-1/games/game-1/liveEvents') }), expect.objectContaining({
      eventId: expect.stringMatching(/^app-live-/),
      type: 'stat',
      period: 'Q3',
      gameClockMs: 245000,
      playerId: 'player-1',
      statKey: 'pts',
      value: 2,
      isOpponent: false
    }));
  });

  it('increments away score when the team is the away side', async () => {
    const result = await recordPlayerScoringStat('team-1', 'game-1', 'player-1', {
      statKey: 'pts',
      value: 2,
      teamSide: 'away',
      playerName: 'Avery Smith',
      playerNumber: '12'
    }, { uid: 'coach-1', displayName: '', email: 'coach@example.com', roles: [] });

    expect(result).toMatchObject({
      homeScore: 10,
      awayScore: 10,
      playerId: 'player-1',
      statKey: 'pts',
      value: 2,
      playerPoints: 6
    });
    expect(mocks.transactionSet).toHaveBeenCalledWith(expect.objectContaining({ path: 'teams/team-1/games/game-1' }), expect.objectContaining({
      homeScore: 10,
      awayScore: 10,
      liveStatus: 'live',
      liveHasData: true,
      liveStartedAt: expect.any(Date)
    }), { merge: true });
    expect(mocks.transactionSet).toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringContaining('teams/team-1/games/game-1/liveEvents') }), expect.objectContaining({
      eventId: expect.stringMatching(/^app-live-/),
      type: 'stat',
      period: 'Q3',
      gameClockMs: 245000,
      playerId: 'player-1',
      homeScore: 10,
      awayScore: 10,
      statKey: 'pts',
      value: 2,
      isOpponent: false
    }));
  });

  it('records a foul event without changing the score and writes the legacy event doc', async () => {
    const result = await recordPlayerGameStat('team-1', 'game-1', 'player-1', {
      statKey: 'fouls',
      value: 1,
      playerName: 'Avery Smith',
      playerNumber: '12'
    }, { uid: 'coach-1', displayName: '', email: 'coach@example.com', roles: [] });

    expect(result).toMatchObject({
      homeScore: 10,
      awayScore: 8,
      playerId: 'player-1',
      statKey: 'fouls',
      value: 1,
      playerStatTotal: 1,
      trackerEventId: expect.stringMatching(/^app-live-/),
      liveEventId: expect.stringMatching(/^app-live-/)
    });
    expect(mocks.transactionSet).toHaveBeenCalledWith(expect.objectContaining({ path: 'teams/team-1/games/game-1' }), expect.not.objectContaining({ homeScore: 12 }), { merge: true });
    expect(mocks.transactionSet).toHaveBeenCalledWith(expect.objectContaining({ path: 'teams/team-1/games/game-1/aggregatedStats/player-1' }), expect.objectContaining({
      stats: { fouls: { __increment: 1 } }
    }), { merge: true });
    expect(mocks.transactionSet).toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringContaining('teams/team-1/games/game-1/events/') }), expect.objectContaining({
      text: '#12 Avery Smith FOULS +1',
      gameTime: '04:05',
      period: 'Q3',
      type: 'stat',
      playerId: 'player-1',
      statKey: 'fouls',
      value: 1,
      isOpponent: false,
      createdBy: 'coach-1'
    }));
  });

  it('undoes a recorded foul by appending compensating live and tracker events', async () => {
    mocks.transactionGet.mockReset();
    mocks.transactionGet
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ homeScore: 10, awayScore: 8 }) })
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ stats: { fouls: 4 } }) });

    const result = await undoRecordedPlayerGameStat('team-1', 'game-1', {
      trackerEventId: 'tracker-foul-1',
      liveEventId: 'live-foul-1',
      playerId: 'player-1',
      playerName: 'Avery Smith',
      playerNumber: '12',
      statKey: 'fouls',
      value: 1
    }, { uid: 'coach-1', displayName: '', email: 'coach@example.com', roles: [] });

    expect(result).toMatchObject({
      homeScore: 10,
      awayScore: 8,
      playerId: 'player-1',
      statKey: 'fouls',
      playerStatTotal: 3,
      trackerEventId: expect.stringMatching(/^app-live-/),
      liveEventId: expect.stringMatching(/^app-live-/),
      liveEvent: expect.objectContaining({
        type: 'stat',
        statKey: 'fouls',
        value: -1,
        description: 'Undo #12 Avery Smith FOULS +1'
      })
    });
    expect(mocks.transactionSet).toHaveBeenCalledWith(expect.objectContaining({ path: 'teams/team-1/games/game-1/aggregatedStats/player-1' }), expect.objectContaining({
      stats: { fouls: { __increment: -1 } }
    }), { merge: true });
    expect(mocks.transactionSet).toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringContaining('teams/team-1/games/game-1/liveEvents/') }), expect.objectContaining({
      type: 'stat',
      statKey: 'fouls',
      value: -1,
      description: 'Undo #12 Avery Smith FOULS +1'
    }));
    expect(mocks.transactionSet).toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringContaining('teams/team-1/games/game-1/events/') }), expect.objectContaining({
      text: '#12 Avery Smith FOULS -1',
      statKey: 'fouls',
      value: -1,
      createdBy: 'coach-1'
    }));
  });

  it('rejects player scoring after the game is final', async () => {
    mocks.transactionGet.mockReset();
    mocks.transactionGet
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ homeScore: 10, awayScore: 8, liveStatus: 'completed' }) })
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ stats: { pts: 4 } }) });

    await expect(recordPlayerScoringStat('team-1', 'game-1', 'player-1', {
      statKey: 'pts',
      value: 2,
      playerName: 'Avery Smith',
      playerNumber: '12'
    }, { uid: 'coach-1', displayName: '', email: 'coach@example.com', roles: [] })).rejects.toThrow('game is final');
  });

  it('rejects missing required identity inputs', async () => {
    const user = { uid: 'coach-1', displayName: '', email: 'coach@example.com', roles: [] };
    await expect(recordPlayerScoringStat('', 'game-1', 'player-1', { statKey: 'pts', value: 2 }, user)).rejects.toThrow('scheduled game');
    await expect(recordPlayerScoringStat('team-1', 'game-1', '', { statKey: 'pts', value: 2 }, user)).rejects.toThrow('Select a player');
    await expect(recordPlayerScoringStat('team-1', 'game-1', 'player-1', { statKey: 'pts', value: 2 }, null as any)).rejects.toThrow('Sign in');
  });
});

describe('mobile lineup draft creation', () => {
  const user = { uid: 'coach-1', displayName: 'Coach', email: 'coach@example.com', roles: [] };
  const event = {
    eventKey: 'team-1::game-1::player-1',
    id: 'game-1',
    teamId: 'team-1',
    teamName: 'Bears',
    type: 'game',
    date: new Date('2026-05-31T18:00:00Z'),
    location: 'Main Gym',
    childId: 'player-1',
    childName: 'Avery',
    isDbGame: true,
    isCancelled: false,
    isTeamStaff: true,
    assignments: [],
    gamePlan: {
      lineups: { 'Q1-pg': 'old-player' },
      isPublished: true,
      publishedVersion: 2,
      publishedLineups: { 'Q1-pg': 'published-player' },
      publishedBy: 'coach-0'
    }
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPlayers).mockResolvedValue([
      { id: 'p1', name: 'Avery', number: '1' },
      { id: 'p2', name: 'Blake', number: '2' },
      { id: 'p3', name: 'Casey', number: '3' },
      { id: 'p4', name: 'Devon', number: '4' },
      { id: 'p5', name: 'Emery', number: '5' },
      { id: 'p6', name: 'Finley', number: '6' }
    ] as any);
    vi.mocked(getRsvps).mockResolvedValue([
      { playerId: 'p1', response: 'going' },
      { playerId: 'p2', response: 'going' },
      { playerId: 'p3', response: 'maybe' },
      { playerId: 'p4', response: 'not_going' },
      { playerId: 'p5', response: 'going' }
    ] as any);
    vi.mocked(updateGame).mockResolvedValue(undefined as any);
  });

  it('saves an auto-filled draft from Going players only and preserves published fields', async () => {
    const result = await saveScheduledGameLineupDraftForApp(event, user, 'basketball-5v5');

    expect(updateGame).toHaveBeenCalledWith('team-1', 'game-1', {
      gamePlan: expect.objectContaining({
        formationId: 'basketball-5v5',
        numPeriods: 4,
        isPublished: false,
        publishedVersion: 2,
        publishedLineups: { 'Q1-pg': 'published-player' },
        publishedBy: 'coach-0',
        lineups: {
          'Q1-pg': 'p1',
          'Q1-sg': 'p2',
          'Q1-sf': 'p5'
        }
      })
    });
    expect(result.gamePlan?.lineups).toEqual({
      'Q1-pg': 'p1',
      'Q1-sg': 'p2',
      'Q1-sf': 'p5'
    });
    expect(result.availablePlayers).toEqual([
      expect.objectContaining({ id: 'p1' }),
      expect.objectContaining({ id: 'p2' }),
      expect.objectContaining({ id: 'p3' }),
      expect.objectContaining({ id: 'p4' }),
      expect.objectContaining({ id: 'p5' }),
      expect.objectContaining({ id: 'p6' })
    ]);
  });

  it('falls back from parent-only Going RSVP docs to linked roster players', async () => {
    vi.mocked(getPlayers).mockResolvedValue([
      { id: 'p1', name: 'Avery', number: '1', parentUserId: 'parent-1' },
      { id: 'p2', name: 'Blake', number: '2', parents: [{ userId: 'parent-2' }] },
      { id: 'p3', name: 'Casey', number: '3', guardianUserId: 'parent-3' },
      { id: 'p4', name: 'Devon', number: '4', parentUserId: 'parent-4' }
    ] as any);
    vi.mocked(getRsvps).mockResolvedValue([
      { userId: 'parent-1', response: 'going' },
      { userId: 'parent-2', response: 'going' },
      { userId: 'parent-3', response: 'maybe' },
      { userId: 'parent-4', response: 'not_going' }
    ] as any);

    const result = await saveScheduledGameLineupDraftForApp(event, user, 'basketball-5v5');

    expect(result.gamePlan?.lineups).toEqual({
      'Q1-pg': 'p1',
      'Q1-sg': 'p2'
    });
  });

  it('persists manual multi-period lineup edits through the shared draft path', async () => {
    const result = await saveScheduledGameLineupDraftForApp(event, user, 'basketball-5v5', {
      lineups: {
        'Q1-pg': 'p2',
        'Q1-sg': 'p1',
        'Q2-pg': 'p5'
      }
    });

    expect(updateGame).toHaveBeenCalledWith('team-1', 'game-1', {
      gamePlan: expect.objectContaining({
        formationId: 'basketball-5v5',
        lineups: {
          'Q1-pg': 'p2',
          'Q1-sg': 'p1',
          'Q2-pg': 'p5'
        }
      })
    });
    expect(result.gamePlan?.lineups).toEqual({
      'Q1-pg': 'p2',
      'Q1-sg': 'p1',
      'Q2-pg': 'p5'
    });
  });

  it('allows manual lineup edits to save when no players are marked Going', async () => {
    vi.mocked(getRsvps).mockResolvedValue([{ playerId: 'p1', response: 'maybe' }] as any);

    const result = await saveScheduledGameLineupDraftForApp(event, user, 'basketball-5v5', {
      lineups: {
        'Q1-pg': 'p1'
      }
    });

    expect(updateGame).toHaveBeenCalledWith('team-1', 'game-1', {
      gamePlan: expect.objectContaining({
        formationId: 'basketball-5v5',
        isPublished: false,
        publishedVersion: 2,
        publishedLineups: { 'Q1-pg': 'published-player' },
        lineups: { 'Q1-pg': 'p1' }
      })
    });
    expect(result.gamePlan?.lineups).toEqual({ 'Q1-pg': 'p1' });
  });

  it('persists an empty manual lineup when every slot is cleared', async () => {
    const result = await saveScheduledGameLineupDraftForApp(event, user, 'basketball-5v5', {
      lineups: {}
    });

    expect(updateGame).toHaveBeenCalledWith('team-1', 'game-1', {
      gamePlan: expect.objectContaining({
        formationId: 'basketball-5v5',
        lineups: {},
        publishedLineups: { 'Q1-pg': 'published-player' }
      })
    });
    expect(result.gamePlan?.lineups).toEqual({});
  });

  it('rejects unsupported events and empty Going player pools', async () => {
    await expect(saveScheduledGameLineupDraftForApp({ ...event, isDbGame: false }, user, 'basketball-5v5')).rejects.toThrow('scheduled game');
    await expect(saveScheduledGameLineupDraftForApp(event, null as any, 'basketball-5v5')).rejects.toThrow('Sign in');
    await expect(saveScheduledGameLineupDraftForApp(event, user, 'baseball-9')).rejects.toThrow('supported formation');

    vi.mocked(getRsvps).mockResolvedValue([{ playerId: 'p1', response: 'maybe' }] as any);
    await expect(saveScheduledGameLineupDraftForApp(event, user, 'basketball-5v5')).rejects.toThrow('No Going players');
  });
});

describe('staff RSVP management', () => {
  const user = { uid: 'coach-1', displayName: 'Coach', email: 'coach@example.com', roles: [] };
  const event = {
    id: 'game-1',
    teamId: 'team-1',
    childId: 'child-event-player',
    isDbGame: true,
    isCancelled: false,
    availabilityLocked: false,
    isTeamAdmin: true,
    isTeamStaff: true,
    isTeamRsvpReminderManager: true
  } as any;
  let restoreTestWindow: (() => void) | null = null;

  function installTestWindow() {
    const previousWindow = (globalThis as any).window;
    (globalThis as any).window = {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      location: { protocol: 'http:' }
    };
    return () => {
      if (previousWindow === undefined) {
        delete (globalThis as any).window;
      } else {
        (globalThis as any).window = previousWindow;
      }
    };
  }

  function buildSharedRsvpSource(missingPlayerId = 'p2') {
    const goingRow = { playerId: 'p1', playerName: 'Avery Smith', response: 'going' };
    const missingRow = { playerId: missingPlayerId, playerName: missingPlayerId === 'p2' ? 'Devon Lee' : 'Blake Jones', response: 'not_responded' };
    const notResponded = missingPlayerId ? [missingRow] : [];
    return {
      players: [
        { id: 'p1', name: 'Avery Smith', active: true, parents: [{ email: 'avery@example.com' }] },
        { id: 'p2', name: 'Devon Lee', active: true, parents: [{ email: 'devon@example.com' }] }
      ],
      rsvps: missingPlayerId
        ? [{ playerId: 'p1', response: 'going' }]
        : [{ playerId: 'p1', response: 'going' }, { playerId: 'p2', response: 'going' }],
      grouped: {
        going: missingPlayerId ? [goingRow] : [goingRow, { playerId: 'p2', playerName: 'Devon Lee', response: 'going' }],
        maybe: [],
        not_going: [],
        not_responded: notResponded
      },
      counts: {
        going: missingPlayerId ? 1 : 2,
        maybe: 0,
        notGoing: 0,
        notResponded: notResponded.length,
        total: 2
      }
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    restoreTestWindow?.();
    restoreTestWindow = installTestWindow();
  });

  afterEach(() => {
    restoreTestWindow?.();
    restoreTestWindow = null;
  });

  it('maps staff RSVP breakdown rows including no-response players', async () => {
    vi.mocked(getRsvpBreakdownByPlayer).mockResolvedValue({
      grouped: {
        going: [{ playerId: 'p1', playerName: 'Avery Smith', response: 'going' }],
        maybe: [{ playerId: 'p2', playerName: 'Blake Jones', response: 'maybe' }],
        not_going: [{ playerId: 'p3', playerName: 'Casey Brown', response: 'not_going' }],
        not_responded: [{ playerId: 'p4', playerName: 'Devon Lee', response: 'not_responded' }]
      },
      counts: { going: 1, maybe: 1, notGoing: 1, notResponded: 1, total: 4 }
    } as any);

    const result = await loadStaffScheduleRsvpBreakdown(event, user as any);

    expect(getRsvpBreakdownByPlayer).toHaveBeenCalledWith('team-1', 'game-1');
    expect(result.counts).toEqual({ going: 1, maybe: 1, notGoing: 1, notResponded: 1, total: 4 });
    expect(result.grouped.not_responded).toEqual([
      expect.objectContaining({ playerId: 'p4', playerName: 'Devon Lee', response: 'not_responded' })
    ]);
  });

  it('reuses one in-flight staff RSVP event-data load for breakdown and reminder preview', async () => {
    let resolveEventData!: (value: any) => void;
    vi.mocked(getRsvpBreakdownByPlayer).mockImplementation(() => new Promise((resolve) => {
      resolveEventData = resolve;
    }));

    const loader = createStaffRsvpAvailabilityLoader();
    const breakdownPromise = loader.loadBreakdown(event, user as any);
    const previewPromise = loader.loadReminderPreview(event, user as any);

    expect(getRsvpBreakdownByPlayer).toHaveBeenCalledTimes(1);
    expect(getRsvpBreakdownByPlayer).toHaveBeenCalledWith('team-1', 'game-1');

    resolveEventData(buildSharedRsvpSource('p2'));
    const [breakdown, preview] = await Promise.all([breakdownPromise, previewPromise]);

    expect(breakdown.counts).toMatchObject({ going: 1, notResponded: 1, total: 2 });
    expect(preview.missingPlayerCount).toBe(1);
    expect(preview.eligibleEmailCount).toBe(1);
    expect(preview.players[0]).toMatchObject({ playerId: 'p2', playerName: 'Devon Lee' });
  });

  it('invalidates the shared staff RSVP event-data load before refreshes', async () => {
    vi.mocked(getRsvpBreakdownByPlayer)
      .mockResolvedValueOnce(buildSharedRsvpSource('p2') as any)
      .mockResolvedValueOnce(buildSharedRsvpSource('') as any);

    const loader = createStaffRsvpAvailabilityLoader();
    await expect(loader.loadBreakdown(event, user as any)).resolves.toMatchObject({
      counts: { going: 1, maybe: 0, notGoing: 0, notResponded: 1, total: 2 }
    });
    await expect(loader.loadReminderPreview(event, user as any)).resolves.toMatchObject({
      missingPlayerCount: 1,
      eligibleEmailCount: 1
    });
    expect(getRsvpBreakdownByPlayer).toHaveBeenCalledTimes(1);

    loader.invalidateEvent(event);

    const [breakdown, preview] = await Promise.all([
      loader.loadBreakdown(event, user as any),
      loader.loadReminderPreview(event, user as any)
    ]);
    expect(getRsvpBreakdownByPlayer).toHaveBeenCalledTimes(2);
    expect(breakdown.counts).toMatchObject({ going: 2, notResponded: 0, total: 2 });
    expect(preview.missingPlayerCount).toBe(0);
  });

  it('submits staff RSVP overrides for the selected player instead of event.childId', async () => {
    vi.mocked(submitRsvpForPlayer).mockResolvedValue(undefined as any);

    await submitStaffScheduleRsvpOverride(event, user as any, 'player-override', 'going');

    expect(submitRsvpForPlayer).toHaveBeenCalledWith('team-1', 'game-1', 'coach-1', expect.objectContaining({
      playerId: 'player-override',
      response: 'going'
    }));
    expect(submitRsvpForPlayer).not.toHaveBeenCalledWith('team-1', 'game-1', 'coach-1', expect.objectContaining({
      playerId: 'child-event-player'
    }));
  });

  it('rejects coach-only staff without admin write access', async () => {
    await expect(submitStaffScheduleRsvpOverride({ ...event, isTeamAdmin: false }, user as any, 'player-override', 'going')).rejects.toThrow('Only team owners and admins can manage player RSVPs.');
    expect(submitRsvpForPlayer).not.toHaveBeenCalled();
  });
});

describe('staff practice attendance', () => {
  const user = { uid: 'coach-1', displayName: 'Coach', email: 'coach@example.com', roles: [] };
  const event = {
    id: 'practice-1',
    teamId: 'team-1',
    type: 'practice',
    isDbGame: true,
    isTeamAdmin: true,
    isTeamStaff: true,
    practiceSessionId: 'session-1'
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads roster-backed attendance and defaults unrecorded players to absent', async () => {
    vi.mocked(getPracticeSession).mockResolvedValue({
      id: 'session-1',
      attendance: {
        players: [
          { playerId: 'p1', status: 'present', checkedInAt: new Date('2026-06-04T17:55:00Z') },
          { playerId: 'p2', status: 'late', checkedInAt: new Date('2026-06-04T18:03:00Z') }
        ]
      }
    } as any);
    vi.mocked(getPlayers).mockResolvedValue([
      { id: 'p1', name: 'Avery Smith', jerseyNumber: '1', isActive: true },
      { id: 'p2', name: 'Blake Jones', jerseyNumber: '2', isActive: true },
      { id: 'p3', name: 'Casey Brown', jerseyNumber: '3', isActive: true },
      { id: 'p4', name: 'Inactive Player', jerseyNumber: '4', active: false }
    ] as any);

    const result = await loadStaffPracticeAttendance(event, user as any);

    expect(result).toMatchObject({
      sessionId: 'session-1',
      rosterSize: 3,
      checkedInCount: 2
    });
    expect(result.players).toEqual([
      expect.objectContaining({ playerId: 'p1', status: 'present' }),
      expect.objectContaining({ playerId: 'p2', status: 'late' }),
      expect.objectContaining({ playerId: 'p3', status: 'absent' })
    ]);
  });

  it('persists normalized present, late, and absent statuses through practice attendance updates', async () => {
    vi.mocked(updatePracticeAttendance).mockResolvedValue(undefined as any);

    const result = await saveStaffPracticeAttendance(event, user as any, {
      sessionId: 'session-1',
      teamId: 'team-1',
      eventId: 'practice-1',
      rosterSize: 3,
      checkedInCount: 1,
      players: [
        { playerId: 'p1', displayName: 'Avery Smith', playerNumber: '1', status: 'present' },
        { playerId: 'p2', displayName: 'Blake Jones', playerNumber: '2', status: 'late' },
        { playerId: 'p3', displayName: 'Casey Brown', playerNumber: '3', status: 'absent' }
      ]
    });

    expect(updatePracticeAttendance).toHaveBeenCalledWith(
      'team-1',
      'session-1',
      expect.objectContaining({
        rosterSize: 3,
        checkedInCount: 2,
        players: [
          expect.objectContaining({ playerId: 'p1', status: 'present' }),
          expect.objectContaining({ playerId: 'p2', status: 'late' }),
          expect.objectContaining({ playerId: 'p3', status: 'absent', checkedInAt: null })
        ]
      })
    );
    expect(result.checkedInCount).toBe(2);
  });

  it('rejects coach-only staff without admin write access', async () => {
    await expect(loadStaffPracticeAttendance({ ...event, isTeamAdmin: false }, user as any)).rejects.toThrow('Only team owners and admins can manage practice attendance.');
    await expect(saveStaffPracticeAttendance({ ...event, isTeamAdmin: false }, user as any, {
      sessionId: 'session-1',
      teamId: 'team-1',
      eventId: 'practice-1',
      rosterSize: 0,
      checkedInCount: 0,
      players: []
    })).rejects.toThrow('Only team owners and admins can manage practice attendance.');
    expect(getPracticeSession).not.toHaveBeenCalled();
    expect(updatePracticeAttendance).not.toHaveBeenCalled();
  });
});

describe('native parent schedule Firestore mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).window = { location: { protocol: 'capacitor:' }, setTimeout, clearTimeout } as any;
    (globalThis as any).fetch = vi.fn();
    vi.mocked(loadProfileDocument).mockResolvedValue({
      parentOf: [
        { teamId: 'team-1', playerId: 'child-1', playerName: 'Avery', teamName: 'Bears' }
      ]
    } as any);
    vi.mocked(getTeams).mockResolvedValue([] as any);
    vi.mocked(getTeam).mockResolvedValue({
      id: 'team-1',
      name: 'Bears',
      ownerId: 'coach-1',
      adminEmails: [],
      availabilityPreferences: null,
      notificationEmail: 'bears@example.com',
      calendarUrls: ['https://calendar.example.com/team-1.ics']
    } as any);
    vi.mocked(getGame).mockRejectedValue(new Error('offline'));
    vi.mocked(getGames).mockRejectedValue(new Error('offline'));
    vi.mocked(getPracticeSession).mockResolvedValue(null as any);
    vi.mocked(getPracticeSessions).mockResolvedValue([] as any);
    vi.mocked(getNativeAuthIdToken).mockResolvedValue('native-token' as any);
    vi.mocked(getDoc).mockResolvedValue(playerSnapshot('child-1', { id: 'child-1', name: 'Avery', active: true }) as any);
  });

  it('maps a valid Firestore schedule event record through the native fallback path', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        name: 'projects/allplays-test/databases/(default)/documents/teams/team-1/games/game-1',
        fields: {
          date: { timestampValue: '2026-06-20T18:00:00.000Z' },
          calendarEventUid: { stringValue: 'cal-123' },
          location: { stringValue: 'Main Gym' },
          opponent: { stringValue: 'Tigers' },
          status: { stringValue: 'scheduled' },
          liveClockMs: { integerValue: '120000' },
          liveClockRunning: { booleanValue: true },
          assignments: {
            arrayValue: {
              values: [
                {
                  mapValue: {
                    fields: {
                      role: { stringValue: 'Scoreboard' },
                      claimable: { booleanValue: true }
                    }
                  }
                }
              ]
            }
          },
          sourceMetadata: {
            mapValue: {
              fields: {
                sourceType: { stringValue: 'registration' }
              }
            }
          }
        }
      })
    } as any);

    const result = await loadParentScheduleEventDetail({ uid: 'parent-1', email: 'parent@example.com', roles: [] } as any, {
      teamId: 'team-1',
      eventId: 'game-1',
      hydrateDetails: false,
      expandStaffPlayers: false
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      id: 'game-1',
      teamId: 'team-1',
      type: 'game',
      eventKey: expect.stringContaining('::game-1::'),
      location: 'Main Gym',
      opponent: 'Tigers',
      status: 'scheduled',
      liveClockMs: 120000,
      liveClockRunning: true,
      openAssignmentCount: 1,
      sourceType: 'registration'
    });
    expect(result.events[0].date).toEqual(new Date('2026-06-20T18:00:00.000Z'));
  });

  it('keeps tracked calendar ids on native game loads so imported events do not duplicate db games', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        documents: [
          {
            name: 'projects/allplays-test/databases/(default)/documents/teams/team-1/games/game-1',
            fields: {
              date: { timestampValue: '2026-06-20T18:00:00.000Z' },
              calendarEventUid: { stringValue: 'cal-123' },
              opponent: { stringValue: 'Tigers' },
              location: { stringValue: 'Main Gym' }
            }
          }
        ]
      })
    } as any);
    vi.mocked(fetchAndParseCalendar).mockResolvedValue([
      {
        uid: 'cal-123',
        summary: 'Bears vs Tigers',
        dtstart: '2026-06-20T18:00:00.000Z',
        location: 'Main Gym'
      }
    ] as any);

    const result = await loadParentSchedule({ uid: 'parent-1', email: 'parent@example.com', roles: [] } as any, {
      hydrateDetails: false,
      expandStaffPlayers: false,
      includePastGames: true
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      id: 'game-1',
      type: 'game',
      opponent: 'Tigers',
      isDbGame: true
    });
    expect(fetchAndParseCalendar).toHaveBeenCalledWith('https://calendar.example.com/team-1.ics');
  });

  it('queries native game fallback by date range instead of listing the full games collection', async () => {
    const startDate = new Date('2026-06-01T00:00:00.000Z');
    const endDate = new Date('2026-06-30T23:59:59.000Z');
    vi.mocked(globalThis.fetch).mockImplementation(async (input: any, init?: RequestInit) => {
      const requestUrl = String(input);
      expect(requestUrl).toContain('/documents/teams/team-1:runQuery');
      expect(requestUrl).not.toContain('/documents/teams/team-1/games');
      expect(init?.method).toBe('POST');
      return {
        ok: true,
        json: async () => ([
          {
            document: {
              name: 'projects/allplays-test/databases/(default)/documents/teams/team-1/games/game-in-range',
              fields: {
                date: { timestampValue: '2026-06-20T18:00:00.000Z' },
                opponent: { stringValue: 'Tigers' },
                location: { stringValue: 'Main Gym' }
              }
            }
          }
        ])
      } as any;
    });

    const result = await loadParentSchedule({ uid: 'parent-1', email: 'parent@example.com', roles: [] } as any, {
      hydrateDetails: false,
      expandStaffPlayers: false,
      scheduleRangeByTeam: {
        'team-1': { startDate, endDate }
      }
    });

    expect(result.events.map((event) => event.id)).toEqual(['game-in-range']);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [, requestInit] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(requestInit.body));
    expect(body).toMatchObject({
      structuredQuery: {
        from: [{ collectionId: 'games' }],
        where: {
          compositeFilter: {
            op: 'AND',
            filters: [
              {
                fieldFilter: {
                  field: { fieldPath: 'date' },
                  op: 'GREATER_THAN_OR_EQUAL',
                  value: { timestampValue: startDate.toISOString() }
                }
              },
              {
                fieldFilter: {
                  field: { fieldPath: 'date' },
                  op: 'LESS_THAN_OR_EQUAL',
                  value: { timestampValue: endDate.toISOString() }
                }
              }
            ]
          }
        },
        orderBy: [{ field: { fieldPath: 'date' }, direction: 'ASCENDING' }]
      }
    });
  });

  it('wraps native game fallback start-only filters in a composite filter', async () => {
    const startDate = new Date('2026-06-01T00:00:00.000Z');
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ([])
    } as any);

    await loadParentSchedule({ uid: 'parent-1', email: 'parent@example.com', roles: [] } as any, {
      hydrateDetails: false,
      expandStaffPlayers: false,
      scheduleRangeByTeam: {
        'team-1': { startDate }
      }
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [, requestInit] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(requestInit.body));
    expect(body.structuredQuery.where).toEqual({
      compositeFilter: {
        op: 'AND',
        filters: [
          {
            fieldFilter: {
              field: { fieldPath: 'date' },
              op: 'GREATER_THAN_OR_EQUAL',
              value: { timestampValue: startDate.toISOString() }
            }
          }
        ]
      }
    });
  });

  it('wraps native game fallback end-only filters in a composite filter', async () => {
    const endDate = new Date('2026-06-30T23:59:59.000Z');
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ([])
    } as any);

    await loadParentSchedule({ uid: 'parent-1', email: 'parent@example.com', roles: [] } as any, {
      hydrateDetails: false,
      expandStaffPlayers: false,
      scheduleRangeByTeam: {
        'team-1': { endDate }
      }
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [, requestInit] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(requestInit.body));
    expect(body.structuredQuery.where).toEqual({
      compositeFilter: {
        op: 'AND',
        filters: [
          {
            fieldFilter: {
              field: { fieldPath: 'date' },
              op: 'LESS_THAN_OR_EQUAL',
              value: { timestampValue: endDate.toISOString() }
            }
          }
        ]
      }
    });
  });

  it('drops malformed Firestore schedule event records at the mapper boundary', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        name: 'projects/allplays-test/databases/(default)/documents/teams/team-1/games/game-2',
        fields: {
          type: { stringValue: 'game' },
          date: { stringValue: 'not-a-date' },
          location: { integerValue: '42' }
        }
      })
    } as any);

    const result = await loadParentScheduleEventDetail({ uid: 'parent-1', email: 'parent@example.com', roles: [] } as any, {
      teamId: 'team-1',
      eventId: 'game-2',
      hydrateDetails: false,
      expandStaffPlayers: false
    });

    expect(result.events).toEqual([]);
  });
});

describe('partial parent schedule team failures (#3021)', () => {
  const parentUser = {
    uid: 'parent-1',
    email: 'parent@example.com',
    parentOf: [
      { teamId: 'team-1', playerId: 'p1', playerName: 'Kid One' },
      { teamId: 'team-2', playerId: 'p2', playerName: 'Kid Two' }
    ]
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).window = { location: { protocol: 'https:' }, setTimeout, clearTimeout } as any;
    vi.mocked(loadProfileDocument).mockResolvedValue({
      parentOf: parentUser.parentOf
    } as any);
    vi.mocked(getTeam).mockImplementation(async (teamId: string) => ({ id: teamId, name: teamId === 'team-1' ? 'Team One' : 'Team Two' }) as any);
    vi.mocked(getTeams).mockResolvedValue([] as any);
    vi.mocked(getPracticeSessions).mockResolvedValue([] as any);
    vi.mocked(getDoc).mockImplementation(async (ref: any) => {
      if (ref?.path?.includes('team-1/players/p1')) return playerSnapshot('p1', { id: 'p1', name: 'Kid One', active: true }) as any;
      if (ref?.path?.includes('team-2/players/p2')) return playerSnapshot('p2', { id: 'p2', name: 'Kid Two', active: true }) as any;
      return playerSnapshot('missing', null) as any;
    });
  });

  it('keeps successful teams visible when one team schedule load fails', async () => {
    vi.mocked(getGames).mockImplementation(async (teamId: string) => {
      if (teamId === 'team-2') {
        throw new Error('permission-denied');
      }
      return [{
        id: 'game-1',
        type: 'game',
        date: new Date('2026-06-25T18:00:00.000Z'),
        opponent: 'Tigers',
        location: 'Main Gym'
      }] as any;
    });

    const result = await loadParentSchedule(parentUser, { hydrateDetails: false, expandStaffPlayers: false });

    expect(result.children).toEqual(expect.arrayContaining([
      expect.objectContaining({ teamId: 'team-1', playerId: 'p1' }),
      expect.objectContaining({ teamId: 'team-2', playerId: 'p2' })
    ]));
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      teamId: 'team-1',
      id: 'game-1',
      opponent: 'Tigers'
    });
    expect(result.isPartial).toBe(true);
  });

  it('rethrows a typed schedule load error when every team schedule load fails', async () => {
    vi.mocked(getGames).mockRejectedValue(new Error('permission-denied'));

    await expect(loadParentSchedule(parentUser, { hydrateDetails: false, expandStaffPlayers: false })).rejects.toMatchObject({
      name: 'AppServiceError',
      type: 'permission',
      message: 'permission-denied'
    });
  });

});

describe('web-created tournament standings hydration (#1967)', () => {
  const parentUser = {
    uid: 'parent-1',
    email: 'parent@example.com',
    parentOf: [{ teamId: 'team-1', playerId: 'p1', playerName: 'Kid One' }]
  } as any;
  const tournamentGames = [
    {
      id: 'pool-a-1',
      type: 'game',
      date: new Date('2026-06-20T18:00:00.000Z'),
      competitionType: 'tournament',
      status: 'completed',
      homeScore: 3,
      awayScore: 1,
      tournament: {
        poolName: 'Pool A',
        slotAssignments: {
          home: { sourceType: 'team', teamName: 'Tigers' },
          away: { sourceType: 'team', teamName: 'Lions' }
        }
      }
    },
    {
      id: 'pool-a-2',
      type: 'game',
      date: new Date('2026-06-21T18:00:00.000Z'),
      competitionType: 'tournament',
      status: 'completed',
      homeScore: 2,
      awayScore: 0,
      tournament: {
        poolName: 'Pool A',
        slotAssignments: {
          home: { sourceType: 'team', teamName: 'Bears' },
          away: { sourceType: 'team', teamName: 'Tigers' }
        }
      }
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).window = { location: { protocol: 'https:' }, setTimeout, clearTimeout } as any;
    vi.mocked(loadProfileDocument).mockResolvedValue({ parentOf: parentUser.parentOf } as any);
    vi.mocked(getTeam).mockResolvedValue({
      id: 'team-1',
      name: 'Tigers',
      standingsConfig: { rankingMode: 'points', points: { win: 3, tie: 1, loss: 0 } }
    } as any);
    vi.mocked(getTeams).mockResolvedValue([] as any);
    vi.mocked(getGames).mockResolvedValue(tournamentGames as any);
    vi.mocked(getPracticeSessions).mockResolvedValue([] as any);
    vi.mocked(getDoc).mockResolvedValue(playerSnapshot('p1', { id: 'p1', name: 'Kid One', active: true }) as any);
  });

  it('computes standings from the bounded schedule game load without a full-history reread', async () => {
    const result = await loadParentSchedule(parentUser, { hydrateDetails: false, expandStaffPlayers: false });

    expect(getGames).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getGames).mock.calls[0][1]).toMatchObject({ startDate: expect.any(Date) });
    expect(getScheduleTournamentInfo(result.events[0] as any).standings).toMatchObject({
      groupName: 'Pool A',
      rows: [
        { rank: '1', teamName: 'Bears', record: '1-0', points: 3 },
        { rank: '2', teamName: 'Tigers', record: '1-1', points: 3 },
        { rank: '3', teamName: 'Lions', record: '0-1', points: 0 }
      ]
    });
  });

  it('hydrates a direct tournament detail route from the bounded tournament pool', async () => {
    vi.mocked(getGame).mockResolvedValue(tournamentGames[0] as any);

    const result = await loadParentScheduleEventDetail(parentUser, {
      teamId: 'team-1',
      eventId: 'pool-a-1',
      hydrateDetails: false,
      expandStaffPlayers: false
    });

    expect(getGame).toHaveBeenCalledWith('team-1', 'pool-a-1');
    expect(getGames).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getGames).mock.calls[0][1]).toMatchObject({
      startDate: expect.any(Date),
      endDate: expect.any(Date)
    });
    expect(getScheduleTournamentInfo(result.events[0] as any).standings?.rows).toEqual([
      { rank: '1', teamName: 'Bears', record: '1-0', points: 3 },
      { rank: '2', teamName: 'Tigers', record: '1-1', points: 3 },
      { rank: '3', teamName: 'Lions', record: '0-1', points: 0 }
    ]);
  });
});

describe('team schedule game windowing (#2034)', () => {
  const parentUser = {
    uid: 'parent-1',
    email: 'parent@example.com',
    parentOf: [{ teamId: 'team-1', playerId: 'p1', playerName: 'Kid One' }]
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadProfileDocument).mockResolvedValue({
      parentOf: [{ teamId: 'team-1', playerId: 'p1', playerName: 'Kid One' }]
    } as any);
    vi.mocked(getTeam).mockResolvedValue({ id: 'team-1', name: 'Team One' } as any);
    vi.mocked(getTeams).mockResolvedValue([] as any);
    vi.mocked(getGames).mockResolvedValue([] as any);
    vi.mocked(getPracticeSessions).mockResolvedValue([] as any);
    vi.mocked(getDoc).mockResolvedValue(playerSnapshot('p1', { id: 'p1', name: 'Kid One', active: true }) as any);
  });

  it('windows games to a recent startDate by default', async () => {
    await loadParentSchedule(parentUser, { hydrateDetails: false, expandStaffPlayers: false });
    expect(getGames).toHaveBeenCalledTimes(1);
    const [teamId, options] = vi.mocked(getGames).mock.calls[0] as [string, any];
    expect(teamId).toBe('team-1');
    expect(options?.startDate).toBeInstanceOf(Date);
    expect(options?.endDate ?? null).toBeNull();
  });

  it('loads full history (no startDate) when includePastGames is set', async () => {
    await loadParentSchedule(parentUser, { hydrateDetails: false, expandStaffPlayers: false, includePastGames: true });
    expect(getGames).toHaveBeenCalledTimes(1);
    const [, options] = vi.mocked(getGames).mock.calls[0] as [string, any];
    expect(options?.startDate ?? null).toBeNull();
  });

  it('maps legacy game reads through the schedule event mapper before building parent rows', async () => {
    vi.mocked(getGames).mockResolvedValue([
      {
        id: 'game-1',
        type: 'game',
        date: new Date('2026-06-25T18:00:00.000Z'),
        opponent: 'Tigers',
        liveClockMs: '90000',
        liveClockRunning: 'yes',
        assignments: [{ role: 'Clock', value: 'Open' }]
      },
      {
        id: 'bad-game',
        type: 'game',
        date: 'not-a-date',
        opponent: 'Should drop'
      }
    ] as any);

    const result = await loadParentSchedule(parentUser, { hydrateDetails: false, expandStaffPlayers: false });

    expect(result.events.map((event) => event.id)).toEqual(['game-1']);
    expect(result.events[0]).toMatchObject({
      opponent: 'Tigers',
      liveClockMs: 90000,
      liveClockRunning: null,
      assignments: [{ role: 'Clock', value: 'Open' }]
    });
  });

  it('keeps recurring practice masters available during windowed schedule loads', async () => {
    vi.mocked(getGames).mockResolvedValue([
      {
        id: 'game-1',
        type: 'game',
        date: new Date('2026-06-25T18:00:00.000Z'),
        opponent: 'Tigers',
        location: 'Field 1'
      },
      {
        id: 'practice-master',
        type: 'practice',
        isSeriesMaster: true,
        recurrence: { freq: 'weekly', interval: 1 },
        date: new Date('2025-01-08T18:00:00.000Z'),
        location: 'North Field',
        title: 'Weekly Practice'
      }
    ] as any);
    vi.mocked(expandRecurrence).mockReturnValue([
      {
        masterId: 'practice-master',
        instanceDate: '2026-06-24',
        date: '2026-06-24T18:00:00.000Z',
        endDate: new Date('2026-06-24T19:30:00.000Z'),
        location: 'North Field',
        title: 'Weekly Practice',
        notes: 'Bring water'
      }
    ] as any);

    const result = await loadParentSchedule(parentUser, { hydrateDetails: false, expandStaffPlayers: false });

    expect(getGames).toHaveBeenCalledTimes(1);
    expect(getDocs).not.toHaveBeenCalled();
    expect(result.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'practice-master__2026-06-24',
        type: 'practice',
        isDbGame: true,
        location: 'North Field',
        notes: 'Bring water'
      })
    ]));
  });

  it('preserves recurrence exception fields when mapping legacy recurring practice masters', () => {
    const mapped = mapScheduleEventRecord({
      id: 'practice-master',
      type: 'practice',
      isSeriesMaster: true,
      recurrence: { freq: 'weekly', interval: 1, byDays: ['WE'] },
      date: new Date('2025-01-08T18:00:00.000Z'),
      end: new Date('2025-01-08T19:30:00.000Z'),
      location: 'North Field',
      title: 'Weekly Practice',
      startTime: '18:00',
      endDayOffset: 1,
      exDates: ['2026-06-17'],
      overrides: {
        '2026-06-24': {
          title: 'Adjusted Practice',
          location: 'South Field'
        }
      }
    });

    expect(mapped).toMatchObject({
      id: 'practice-master',
      startTime: '18:00',
      endDayOffset: 1,
      exDates: ['2026-06-17'],
      overrides: {
        '2026-06-24': {
          title: 'Adjusted Practice',
          location: 'South Field'
        }
      }
    });
  });
});

describe('resolveCachedParentScheduleEvents (#2649)', () => {
  beforeEach(() => {
    vi.mocked(getCachedAppData).mockReset();
  });

  it('returns every matching child-event row for the route target from cached schedule data', () => {
    vi.mocked(getCachedAppData).mockReturnValue({
      children: [],
      events: [
        { id: 'e1', teamId: 't1', childId: 'c1' },
        { id: 'e1', teamId: 't1', childId: 'c2' },
        { id: 'e2', teamId: 't1', childId: 'c1' },
        { id: 'e1', teamId: 't9', childId: 'c1' }
      ]
    } as never);

    const result = resolveCachedParentScheduleEvents('u1', 't1', 'e1');

    expect(result.map((event) => event.childId)).toEqual(['c1', 'c2']);
    expect(getCachedAppData).toHaveBeenCalledWith('app-schedule-summary:u1');
  });

  it('returns empty without reading the cache when identifiers are blank', () => {
    vi.mocked(getCachedAppData).mockReturnValue({ children: [], events: [{ id: 'e1', teamId: 't1', childId: 'c1' }] } as never);

    expect(resolveCachedParentScheduleEvents('', 't1', 'e1')).toEqual([]);
    expect(resolveCachedParentScheduleEvents('u1', '', 'e1')).toEqual([]);
    expect(resolveCachedParentScheduleEvents('u1', 't1', '')).toEqual([]);
    expect(getCachedAppData).not.toHaveBeenCalled();
  });

  it('returns empty on a cache miss', () => {
    vi.mocked(getCachedAppData).mockReturnValue(null);
    expect(resolveCachedParentScheduleEvents('u1', 't1', 'e1')).toEqual([]);
  });
});

describe('adjustGameScore', () => {
  const user = { uid: 'coach-1', displayName: 'Coach', email: 'coach@example.com', roles: [] } as any;

  beforeEach(() => {
    (globalThis as any).window = { location: { protocol: 'https:' }, setTimeout, clearTimeout } as any;
    vi.clearAllMocks();
    mocks.transactionGet.mockReset();
  });

  it('atomically adds the delta to the authoritative server score', async () => {
    mocks.transactionGet.mockResolvedValue({
      exists: () => true,
      data: () => ({ homeScore: 10, awayScore: 8 })
    });

    const result = await adjustGameScore('team-1', 'game-1', { homeScore: 2, awayScore: 0 } as any, user);

    expect(mocks.runTransactionMock).toHaveBeenCalledTimes(1);
    expect(mocks.transactionSet).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'teams/team-1/games/game-1' }),
      expect.objectContaining({ homeScore: 12, awayScore: 8, scoreUpdatedBy: 'coach-1' }),
      { merge: true }
    );
    expect(result).toMatchObject({ homeScore: 12, awayScore: 8, shared: false });
    // Non-shared games are written once inside the transaction; no absolute mirror write.
    expect(vi.mocked(updateGame)).not.toHaveBeenCalled();
  });

  it('applies a negative (undo) delta and never drops the score below zero', async () => {
    mocks.transactionGet.mockResolvedValue({
      exists: () => true,
      data: () => ({ homeScore: 1, awayScore: 0 })
    });

    const result = await adjustGameScore('team-1', 'game-1', { homeScore: -2, awayScore: 0 } as any, user);

    expect(mocks.transactionSet).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'teams/team-1/games/game-1' }),
      expect.objectContaining({ homeScore: 0, awayScore: 0 }),
      { merge: true }
    );
    expect(result).toMatchObject({ homeScore: 0, awayScore: 0 });
  });

  it('is a no-op for a zero delta and does not open a transaction', async () => {
    const result = await adjustGameScore('team-1', 'game-1', { homeScore: 0, awayScore: 0 } as any, user);

    expect(mocks.runTransactionMock).not.toHaveBeenCalled();
    expect(mocks.transactionSet).not.toHaveBeenCalled();
    expect(result).toMatchObject({ homeScore: null, awayScore: null, shared: false });
  });

  it('mirrors the resolved absolute score inside the transaction for shared-schedule games', async () => {
    mocks.transactionGet.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        homeScore: 4,
        awayScore: 5,
        sharedScheduleId: 'shared_team-1_game-1',
        sharedScheduleOpponentTeamId: 'team-2',
        sharedScheduleOpponentGameId: 'game-2'
      })
    }).mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ homeScore: 5, awayScore: 4 })
    });

    const result = await adjustGameScore('team-1', 'game-1', { homeScore: 0, awayScore: 3 } as any, user);

    expect(result).toMatchObject({ homeScore: 4, awayScore: 8, shared: true });
    expect(mocks.transactionSet).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'teams/team-1/games/game-1' }),
      expect.objectContaining({ homeScore: 4, awayScore: 8 }),
      { merge: true }
    );
    expect(mocks.transactionSet).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'teams/team-2/games/game-2' }),
      expect.objectContaining({ homeScore: 8, awayScore: 4 }),
      { merge: true }
    );
    expect(vi.mocked(updateGame)).not.toHaveBeenCalled();
  });

  it('rejects a missing game instead of creating a partial score document', async () => {
    mocks.transactionGet.mockResolvedValue({
      exists: () => false,
      data: () => null
    });

    await expect(adjustGameScore('team-1', 'missing-game', { homeScore: 1, awayScore: 0 } as any, user)).rejects.toThrow('Scheduled game not found');

    expect(mocks.transactionSet).not.toHaveBeenCalled();
    expect(vi.mocked(updateGame)).not.toHaveBeenCalled();
  });

  it('rejects when the game or user is missing', async () => {
    await expect(adjustGameScore('', 'game-1', { homeScore: 1, awayScore: 0 } as any, user)).rejects.toThrow('A scheduled game is required');
    await expect(adjustGameScore('team-1', 'game-1', { homeScore: 1, awayScore: 0 } as any, null as any)).rejects.toThrow('Sign in');
  });
});
