import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const transactionSet = vi.fn();
  const transactionGet = vi.fn();
  const transactionDelete = vi.fn();
  const runTransactionMock = vi.fn(async (_db: unknown, callback: any) => callback({
    get: transactionGet,
    set: transactionSet,
    delete: transactionDelete
  }));
  return { transactionSet, transactionGet, transactionDelete, runTransactionMock };
});

vi.mock('./adapters/legacyScheduleDb', () => ({
  db: {},
  doc: vi.fn((first: any, ...rest: any[]) => ({ path: typeof first?.path === 'string' ? [first.path, ...rest].filter(Boolean).join('/') : rest.filter(Boolean).join('/') })),
  collection: vi.fn((_db: unknown, path: string) => ({ path })),
  collectionGroup: vi.fn((_db: unknown, path: string) => ({ path, scope: 'collectionGroup' })),
  query: vi.fn((base: any, ...filters: any[]) => ({ base, filters })),
  where: vi.fn((field: string, op: string, value: any) => ({ field, op, value })),
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

import { addPractice, broadcastLiveEvent, claimOpenOfficiatingSlot, clearOccurrenceOverride, releaseAssignmentClaim, respondToOfficiatingAssignment, updateEvent, updateGame, updateOccurrence, getAssignmentClaims, getGame, getGames, getPlayers, getPracticeSession, getPracticeSessions, getRsvpBreakdownByPlayer, getRsvpSummaries, getRsvps, getTeam, getTeams, listRideOffersForEvent, submitRsvpForPlayer, updatePracticeAttendance, getDocs } from './adapters/legacyScheduleDb';
import { getNativeAuthIdToken } from './authService';
import { fetchAndParseCalendar } from './adapters/legacyScheduleHelpers';
import { getCachedAppData, loadCachedAppData } from './appDataCache';
import { loadProfileDocument } from './profileService';
import { buildPlayerScoringLiveEvent, claimOfficialAssignmentItem, createScheduledPracticeForApp, flushPendingLivePublishOperations, hydrateParentScheduleDetails, loadOfficialAssignments, loadParentSchedule, loadParentScheduleEventDetail, loadScheduledPracticeSeriesForEdit, loadStaffPracticeAttendance, loadStaffScheduleRsvpBreakdown, publishLiveScoreUpdateEvent, recordPlayerGameStat, recordPlayerScoringStat, releaseParentScheduleAssignmentClaim, resolveLiveGameClockSnapshot, resolveParentGameRoute, respondToOfficialAssignmentItem, revertScheduledPracticeOccurrenceForApp, saveScheduledGameLineupDraftForApp, saveStaffPracticeAttendance, submitStaffScheduleRsvpOverride, undoRecordedPlayerGameStat, updateLiveGameClockState, updateScheduledPracticeForApp } from './scheduleService';

it('keeps schedule workflows behind typed legacy adapters', () => {
  const scheduleServiceSource = readFileSync('src/lib/scheduleService.ts', 'utf8');
  const scheduleEventDetailSource = readFileSync('src/pages/ScheduleEventDetail.tsx', 'utf8');

  expect(scheduleServiceSource).not.toContain("../../../../js/");
  expect(scheduleServiceSource).toContain("./adapters/legacyScheduleDb");
  expect(scheduleServiceSource).toContain("./adapters/legacyScheduleHelpers");
  expect(scheduleServiceSource).toContain("./adapters/legacyAvailability");
  expect(scheduleServiceSource).toContain("./logger");
  expect(scheduleServiceSource).toContain("createLogger('schedule-service')");
  expect(scheduleServiceSource).not.toContain('console.');
  expect(scheduleServiceSource).not.toContain('await Promise.resolve();');
  expect(scheduleServiceSource).toContain('lock.waiters.push(resolve);');
  expect(scheduleEventDetailSource).not.toContain("../../../../js/");
  expect(scheduleEventDetailSource).toContain("../lib/adapters/legacyScheduleHelpers");
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
      startDate: new Date('2026-06-24T17:15:00.000Z'),
      endDate: new Date('2026-06-24T18:45:00.000Z'),
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
      startDate: new Date('2026-06-24T17:15:00.000Z'),
      endDate: new Date('2026-06-24T18:45:00.000Z'),
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
    vi.mocked(getGame).mockImplementation(async (teamId: string, gameId: string) => {
      if (teamId === 'team-bravo' && gameId === 'game-7') {
        return { id: 'game-7', type: 'game' } as any;
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
      childId: 'child-2'
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
      { userId: 'parent-1', playerId: 'player-1', response: 'going', note: 'Will be there.' }
    ] as any);
    vi.mocked(listRideOffersForEvent).mockResolvedValue([] as any);
    vi.mocked(getAssignmentClaims).mockResolvedValue({} as any);
  });

  it('eagerly hydrates only near-term Home events', async () => {
    const nearEvent = buildHydrationEvent('near-game', new Date(Date.now() + 24 * 60 * 60 * 1000));
    const futureEvent = buildHydrationEvent('future-game', new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));

    await hydrateParentScheduleDetails({ children: [], events: [nearEvent, futureEvent] }, user);

    expect(getRsvpSummaries).toHaveBeenCalledWith('team-1', ['near-game']);
    expect(getRsvps).toHaveBeenCalledWith('team-1', 'near-game');
    expect(getRsvps).not.toHaveBeenCalledWith('team-1', 'future-game');
    expect(nearEvent.myRsvp).toBe('going');
    expect(futureEvent.myRsvp).toBe('not_responded');
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
    expect(getGames).toHaveBeenCalledWith('team-alpha');
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
    expect(getGames).toHaveBeenCalledWith('team-alpha');
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
    isTeamStaff: true
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
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
                      value: { stringValue: 'Open' }
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
      expandStaffPlayers: false
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

describe('home schedule hydration bounding (#2033)', () => {
  const user = { uid: 'parent-1', email: 'parent@example.com' } as any;
  const day = 24 * 60 * 60 * 1000;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRsvps).mockResolvedValue([] as any);
    vi.mocked(getRsvpSummaries).mockResolvedValue(new Map() as any);
    vi.mocked(listRideOffersForEvent).mockResolvedValue([] as any);
    vi.mocked(getAssignmentClaims).mockResolvedValue({} as any);
  });

  function makeEvent(id: string, offsetMs: number) {
    return {
      teamId: 'team-1',
      id,
      childId: 'p1',
      isDbGame: true,
      isCancelled: false,
      date: new Date(Date.now() + offsetMs),
      assignments: [],
      availabilityPreferences: {}
    } as any;
  }

  it('only hydrates events inside the look-ahead/look-behind window', async () => {
    const events = [
      makeEvent('soon', 2 * day), // within 14d ahead
      makeEvent('far-future', 40 * day), // beyond the look-ahead window
      makeEvent('old', -5 * day) // beyond the 12h look-behind window
    ];

    await hydrateParentScheduleDetails({ children: [], events }, user);

    const hydratedGameIds = vi.mocked(getRsvps).mock.calls.map((call) => call[1]);
    expect(hydratedGameIds).toContain('soon');
    expect(hydratedGameIds).not.toContain('far-future');
    expect(hydratedGameIds).not.toContain('old');

    expect(events.find((event) => event.id === 'soon')?.rsvpSummary).toBeDefined();
    expect(events.find((event) => event.id === 'far-future')?.rsvpSummary).toBeUndefined();
    expect(events.find((event) => event.id === 'old')?.rsvpSummary).toBeUndefined();
  });
});
