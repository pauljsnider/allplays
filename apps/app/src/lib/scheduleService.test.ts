import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const transactionSet = vi.fn();
  const transactionGet = vi.fn();
  const runTransactionMock = vi.fn(async (_db: unknown, callback: any) => callback({
    get: transactionGet,
    set: transactionSet
  }));
  return { transactionSet, transactionGet, runTransactionMock };
});

vi.mock('../../../../js/firebase.js', () => ({
  db: {},
  doc: vi.fn((first: any, ...rest: any[]) => ({ path: typeof first?.path === 'string' ? [first.path, ...rest].filter(Boolean).join('/') : rest.filter(Boolean).join('/') })),
  collection: vi.fn((_db: unknown, path: string) => ({ path })),
  collectionGroup: vi.fn((_db: unknown, path: string) => ({ path, scope: 'collectionGroup' })),
  query: vi.fn((base: any, ...filters: any[]) => ({ base, filters })),
  where: vi.fn((field: string, op: string, value: any) => ({ field, op, value })),
  getDocs: vi.fn(),
  runTransaction: mocks.runTransactionMock,
  increment: vi.fn((value: number) => ({ __increment: value })),
  serverTimestamp: vi.fn(() => ({ __serverTimestamp: true }))
}));

vi.mock('../../../../js/db.js', () => ({
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
  getTrackedCalendarEventUids: vi.fn(),
  createRideOffer: vi.fn(),
  claimAssignmentSlot: vi.fn(),
  respondToOfficiatingAssignment: vi.fn(),
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

vi.mock('../../../../js/schedule-notifications.js', () => ({
  sendPublicRsvpReminderEmails: vi.fn(),
  buildScheduleNotificationTargets: vi.fn(),
  postScheduleNotificationTargets: vi.fn()
}));
vi.mock('../../../../js/utils.js', () => ({
  expandRecurrence: vi.fn(),
  extractOpponent: vi.fn(),
  fetchAndParseCalendar: vi.fn(),
  getCalendarEventTrackingId: vi.fn(),
  isPracticeEvent: vi.fn(),
  isTrackedCalendarEvent: vi.fn()
}));
vi.mock('../../../../js/parent-dashboard-practice-sessions.js', () => ({ filterVisiblePracticeSessions: vi.fn((items) => items) }));
vi.mock('../../../../js/parent-dashboard-packets.js', () => ({ buildPracticePacketCompletionPayload: vi.fn() }));
vi.mock('../../../../js/parent-dashboard-rsvp.js', () => ({ resolveMyRsvpByChildForGame: vi.fn() }));
vi.mock('../../../../js/availability-preferences.js', () => ({
  buildAvailabilityNoteRows: vi.fn(),
  canViewAvailabilityNotes: vi.fn(),
  formatAvailabilityCutoff: vi.fn(),
  isAvailabilityLocked: vi.fn(),
  normalizeAvailabilityPreferences: vi.fn()
}));
vi.mock('../../../../js/rideshare-helpers.js', () => ({ getEventRideshareSummary: vi.fn() }));
vi.mock('../../../../js/snack-helpers.js', () => ({ mergeAssignmentsWithClaims: vi.fn() }));
vi.mock('../../../../js/team-access.js', () => ({ hasScorekeepingTeamAccess: vi.fn() }));
vi.mock('../../../../js/team-visibility.js', () => ({ isTeamActive: vi.fn(() => true) }));
vi.mock('./profileService', () => ({ loadProfileDocument: vi.fn(), saveProfileDocument: vi.fn() }));
vi.mock('./authService', () => ({ firebaseAuth: {}, getNativeAuthIdToken: vi.fn() }));
vi.mock('./uxTiming', () => ({ startUxTimer: vi.fn(() => ({ end: vi.fn() })) }));
vi.mock('./chatService', () => ({ sendTeamChatMessage: vi.fn() }));
vi.mock('./chatLogic', () => ({ DEFAULT_TEAM_CONVERSATION_ID: 'team' }));
vi.mock('./appDataCache', () => ({ getCachedAppData: vi.fn(), loadCachedAppData: vi.fn(), clearAppDataCache: vi.fn() }));

import { broadcastLiveEvent, claimOpenOfficiatingSlot, respondToOfficiatingAssignment, updateGame, getGame, getGames, getPlayers, getPracticeSession, getPracticeSessions, getRsvpBreakdownByPlayer, getRsvps, getTeam, getTeams, submitRsvpForPlayer, updatePracticeAttendance } from '../../../../js/db.js';
import { getDocs } from '../../../../js/firebase.js';
import { fetchAndParseCalendar } from '../../../../js/utils.js';
import { getCachedAppData } from './appDataCache';
import { loadProfileDocument } from './profileService';
import { buildPlayerScoringLiveEvent, claimOfficialAssignmentItem, loadOfficialAssignments, loadStaffPracticeAttendance, loadStaffScheduleRsvpBreakdown, publishLiveScoreUpdateEvent, recordPlayerScoringStat, resolveParentGameRoute, respondToOfficialAssignmentItem, saveScheduledGameLineupDraftForApp, saveStaffPracticeAttendance, submitStaffScheduleRsvpOverride } from './scheduleService';

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

describe('live score publishing', () => {
  const user = { uid: 'coach-1', displayName: 'Coach', email: 'coach@example.com', roles: [] };

  beforeEach(() => {
    (globalThis as any).window = { location: { protocol: 'https:' }, setTimeout, clearTimeout } as any;
    vi.clearAllMocks();
    vi.mocked(getGame).mockResolvedValue({ id: 'game-1', status: 'scheduled', liveStatus: 'scheduled', liveHasData: false, period: 'Q2', liveClockMs: 321000 } as any);
    vi.mocked(updateGame).mockResolvedValue(undefined as any);
  });

  it('marks the game live before broadcasting app score updates', async () => {
    const result = await publishLiveScoreUpdateEvent('team-1', 'game-1', { homeScore: 12, awayScore: 8 }, user, { homeScore: 10, awayScore: 8 });

    expect(updateGame).toHaveBeenCalledWith('team-1', 'game-1', expect.objectContaining({
      liveStatus: 'live',
      liveHasData: true,
      liveStartedAt: expect.any(Date)
    }));
    expect(broadcastLiveEvent).toHaveBeenCalledWith('team-1', 'game-1', expect.objectContaining({
      eventId: expect.stringMatching(/^app-live-/),
      type: 'score_update',
      period: 'Q2',
      gameClockMs: 321000,
      homeScore: 12,
      awayScore: 8
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

  it('rejects score broadcasts after the game is final', async () => {
    vi.mocked(getGame).mockResolvedValue({ id: 'game-1', status: 'completed', liveStatus: 'completed' } as any);

    await expect(publishLiveScoreUpdateEvent('team-1', 'game-1', { homeScore: 12, awayScore: 8 }, user)).rejects.toThrow('game is final');
    expect(updateGame).not.toHaveBeenCalled();
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
