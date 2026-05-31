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
  getDocs: vi.fn(),
  runTransaction: mocks.runTransactionMock,
  increment: vi.fn((value: number) => ({ __increment: value })),
  serverTimestamp: vi.fn(() => ({ __serverTimestamp: true }))
}));

vi.mock('../../../../js/db.js', () => ({
  getAssignmentClaims: vi.fn(),
  getGames: vi.fn(),
  getPracticePacketCompletions: vi.fn(),
  getPracticeSessions: vi.fn(),
  getPlayers: vi.fn(),
  getRsvps: vi.fn(),
  getRsvpSummaries: vi.fn(),
  getTeam: vi.fn(),
  getTeams: vi.fn(),
  addGame: vi.fn(),
  addPractice: vi.fn(),
  getTrackedCalendarEventUids: vi.fn(),
  createRideOffer: vi.fn(),
  claimAssignmentSlot: vi.fn(),
  requestRideSpot: vi.fn(),
  listRideOffersForEvent: vi.fn(),
  updateRideRequestStatus: vi.fn(),
  closeRideOffer: vi.fn(),
  cancelRideRequest: vi.fn(),
  releaseAssignmentClaim: vi.fn(),
  submitRsvpForPlayer: vi.fn(),
  broadcastLiveEvent: vi.fn(),
  updateGame: vi.fn(),
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

import { updateGame, getPlayers, getRsvps } from '../../../../js/db.js';
import { buildPlayerScoringLiveEvent, recordPlayerScoringStat, saveScheduledGameLineupDraftForApp } from './scheduleService';

describe('player-attributed live scoring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transactionGet
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ homeScore: 10, awayScore: 8 }) })
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
      type: 'stat',
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
    expect(mocks.transactionSet).toHaveBeenCalledWith(expect.objectContaining({ path: 'teams/team-1/games/game-1' }), expect.objectContaining({ homeScore: 12, awayScore: 8 }), { merge: true });
    expect(mocks.transactionSet).toHaveBeenCalledWith(expect.objectContaining({ path: 'teams/team-1/games/game-1/aggregatedStats/player-1' }), expect.objectContaining({
      playerName: 'Avery Smith',
      playerNumber: '12',
      stats: { pts: { __increment: 2 } }
    }), { merge: true });
    expect(mocks.transactionSet).toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringContaining('teams/team-1/games/game-1/liveEvents') }), expect.objectContaining({
      type: 'stat',
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
    expect(mocks.transactionSet).toHaveBeenCalledWith(expect.objectContaining({ path: 'teams/team-1/games/game-1' }), expect.objectContaining({ homeScore: 10, awayScore: 10 }), { merge: true });
    expect(mocks.transactionSet).toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringContaining('teams/team-1/games/game-1/liveEvents') }), expect.objectContaining({
      type: 'stat',
      playerId: 'player-1',
      homeScore: 10,
      awayScore: 10,
      statKey: 'pts',
      value: 2,
      isOpponent: false
    }));
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
  });

  it('rejects unsupported events and empty Going player pools', async () => {
    await expect(saveScheduledGameLineupDraftForApp({ ...event, isDbGame: false }, user, 'basketball-5v5')).rejects.toThrow('scheduled game');
    await expect(saveScheduledGameLineupDraftForApp(event, null as any, 'basketball-5v5')).rejects.toThrow('Sign in');
    await expect(saveScheduledGameLineupDraftForApp(event, user, 'baseball-9')).rejects.toThrow('supported formation');

    vi.mocked(getRsvps).mockResolvedValue([{ playerId: 'p1', response: 'maybe' }] as any);
    await expect(saveScheduledGameLineupDraftForApp(event, user, 'basketball-5v5')).rejects.toThrow('No Going players');
  });
});
