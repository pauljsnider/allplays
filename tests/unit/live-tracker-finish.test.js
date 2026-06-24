import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildFinishCompletionPlan, prepareFinishPlanForSave } from '../../js/live-tracker-finish.js';
import { hasPlayerProfileParticipation } from '../../js/player-profile-stats.js';

describe('live tracker finish completion plan', () => {
  it('honors a coach-entered final score when it differs from the live score log totals', () => {
    const plan = buildFinishCompletionPlan({
      requestedHome: 44,
      requestedAway: 41,
      liveHome: 5,
      liveAway: 2,
      scoreLogIsComplete: true,
      log: [
        { text: 'Home layup', clock: '01:20', period: 'Q1', ts: 11, undoData: { type: 'stat', statKey: 'PTS', value: 2, isOpponent: false, playerId: 'p1' } },
        { text: 'Home three', clock: '00:40', period: 'Q1', ts: 12, undoData: { type: 'stat', statKey: 'PTS', value: 3, isOpponent: false, playerId: 'p2' } },
        { text: 'Away bucket', clock: '00:20', period: 'Q1', ts: 13, undoData: { type: 'stat', statKey: 'points', value: 2, isOpponent: true } }
      ],
      currentPeriod: 'Q4',
      currentClock: '00:00',
      summary: 'Closed well in the final minute.',
      sendEmail: false,
      teamId: 'team-1',
      gameId: 'game-9',
      teamName: 'Tigers',
      opponentName: 'Bears',
      recipientEmail: 'coach@example.com',
      columns: ['PTS', 'AST'],
      roster: [
        { id: 'p1', name: 'Alex', num: '4' },
        { id: 'p2', name: 'Jamie', num: '7' }
      ],
      statsByPlayerId: {
        p1: { pts: 2, ast: 1, fouls: 0, time: 123000 },
        p2: { pts: 3, ast: 0, fouls: 2, time: 118000 }
      },
      opponentEntries: [
        { id: 'opp-1', playerId: 'opp-1', name: 'Pat', number: '12', photoUrl: 'https://img/opp.jpg', stats: { pts: 2, ast: 0, fouls: 1 } }
      ],
      buildEmailBody: () => 'unused body'
    });

    expect(plan.finalHome).toBe(44);
    expect(plan.finalAway).toBe(41);
    expect(plan.scoreReconciliation).toMatchObject({
      mismatch: false,
      derived: { home: 44, away: 41 }
    });
    expect(plan.reconciliationNote).toBe('');
    expect(plan.gameUpdate).toEqual({
      homeScore: 44,
      awayScore: 41,
      summary: 'Closed well in the final minute.',
      status: 'completed',
      opponentStats: {
        'opp-1': {
          name: 'Pat',
          number: '12',
          playerId: 'opp-1',
          photoUrl: 'https://img/opp.jpg',
          pts: 2,
          ast: 0,
          fouls: 1
        }
      }
    });
    expect(plan.eventWrites).toHaveLength(3);
    expect(plan.eventWrites[0]).toEqual({
      data: {
        text: 'Home layup',
        gameTime: '01:20',
        period: 'Q1',
        timestamp: 11,
        type: 'stat',
        playerId: 'p1',
        statKey: 'PTS',
        value: 2,
        isOpponent: false,
        createdBy: null
      }
    });
    expect(plan.aggregatedStatsWrites).toEqual([
      {
        playerId: 'p1',
        data: {
          playerName: 'Alex',
          playerNumber: '4',
          participated: true,
          participationStatus: 'appeared',
          participationSource: 'live-tracker-finish',
          stats: { pts: 2, ast: 1, fouls: 0 },
          timeMs: 123000
        }
      },
      {
        playerId: 'p2',
        data: {
          playerName: 'Jamie',
          playerNumber: '7',
          participated: true,
          participationStatus: 'appeared',
          participationSource: 'live-tracker-finish',
          stats: { pts: 3, ast: 0, fouls: 2 },
          timeMs: 118000
        }
      }
    ]);
    expect(plan.navigation).toEqual([
      { type: 'redirect', href: 'game.html#teamId=team-1&gameId=game-9', delayMs: 0 }
    ]);
  });

  it('marks pre-seeded zero-stat live-tracker players as did not appear', () => {
    const plan = buildFinishCompletionPlan({
      requestedHome: 0,
      requestedAway: 0,
      liveHome: 0,
      liveAway: 0,
      scoreLogIsComplete: true,
      log: [],
      columns: ['PTS', 'REB', 'AST'],
      roster: [
        { id: 'p-zero', name: 'Zero Stat', num: '12' }
      ],
      statsByPlayerId: {
        'p-zero': { pts: 0, reb: 0, ast: 0, fouls: 0, time: 0 }
      },
      opponentEntries: []
    });

    expect(plan.aggregatedStatsWrites).toEqual([
      {
        playerId: 'p-zero',
        data: {
          didNotPlay: true,
          playerName: 'Zero Stat',
          playerNumber: '12',
          participated: false,
          participationStatus: 'did-not-appear',
          participationSource: 'live-tracker-finish',
          stats: { pts: 0, reb: 0, ast: 0, fouls: 0 },
          timeMs: 0
        }
      }
    ]);
    expect(hasPlayerProfileParticipation(plan.aggregatedStatsWrites[0].data)).toBe(false);
  });

  it('keeps live-tracker aggregates with real participation visible in player profile history', () => {
    const standardFinishAggregateDoc = {
      playerName: 'Zero Stat',
      playerNumber: '12',
      participated: true,
      participationStatus: 'appeared',
      participationSource: 'live-tracker-finish',
      stats: { pts: 0, reb: 0, ast: 0, fouls: 0 },
      timeMs: 0
    };

    expect(hasPlayerProfileParticipation(standardFinishAggregateDoc)).toBe(true);
  });

  it('marks live-tracker players with recorded playing time as having appeared even without counting stats', () => {
    const plan = buildFinishCompletionPlan({
      requestedHome: 0,
      requestedAway: 0,
      liveHome: 0,
      liveAway: 0,
      scoreLogIsComplete: true,
      log: [],
      columns: ['PTS', 'REB', 'AST'],
      roster: [
        { id: 'p-minutes', name: 'Minutes Only', num: '21' }
      ],
      statsByPlayerId: {
        'p-minutes': { pts: 0, reb: 0, ast: 0, fouls: 0, time: 60000 }
      },
      opponentEntries: []
    });

    expect(plan.aggregatedStatsWrites).toEqual([
      {
        playerId: 'p-minutes',
        data: {
          playerName: 'Minutes Only',
          playerNumber: '21',
          participated: true,
          participationStatus: 'appeared',
          participationSource: 'live-tracker-finish',
          stats: { pts: 0, reb: 0, ast: 0, fouls: 0 },
          timeMs: 60000
        }
      }
    ]);
    expect(hasPlayerProfileParticipation(plan.aggregatedStatsWrites[0].data)).toBe(true);
  });

  it('splits private player stats into manager-only finish writes', () => {
    const plan = buildFinishCompletionPlan({
      requestedHome: 8,
      requestedAway: 4,
      liveHome: 8,
      liveAway: 4,
      columns: ['PTS', 'EFFORT'],
      statTrackerConfig: {
        columns: ['PTS', 'EFFORT'],
        statDefinitions: [
          { label: 'PTS', acronym: 'PTS' },
          { label: 'Coach Effort', acronym: 'EFFORT', id: 'effort', visibility: 'private', scope: 'player' }
        ]
      },
      roster: [{ id: 'p1', name: 'Alex', num: '4' }],
      statsByPlayerId: { p1: { pts: 8, effort: 5, fouls: 1 } }
    });

    expect(plan.aggregatedStatsWrites).toEqual([
      {
        playerId: 'p1',
        data: {
          participated: true,
          participationSource: 'live-tracker-finish',
          participationStatus: 'appeared',
          playerName: 'Alex',
          playerNumber: '4',
          stats: { pts: 8, fouls: 1 },
          timeMs: 0
        },
        privateData: {
          participated: true,
          participationSource: 'live-tracker-finish',
          stats: { effort: 5 }
        }
      }
    ]);
  });

  it('preserves video timestamp metadata on persisted scoring events', () => {
    const plan = buildFinishCompletionPlan({
      requestedHome: 2,
      requestedAway: 0,
      liveHome: 2,
      liveAway: 0,
      scoreLogIsComplete: true,
      log: [
        {
          text: 'Home layup',
          clock: '01:20',
          period: 'Q1',
          ts: 11,
          undoData: {
            type: 'stat',
            statKey: 'PTS',
            value: 2,
            isOpponent: false,
            playerId: 'p1',
            videoTimestampCaptureActive: true,
            streamRelativeTimestampMs: 12345,
            videoTimestampUnavailableReason: null
          }
        }
      ],
      columns: ['PTS'],
      roster: [],
      statsByPlayerId: {},
      opponentEntries: []
    });

    expect(plan.eventWrites[0].data).toMatchObject({
      videoTimestampCaptureActive: true,
      streamRelativeTimestampMs: 12345,
      videoTimestampUnavailableReason: null
    });
  });

  it('builds a mailto hop before returning to the game page when recap email is enabled', () => {
    const plan = buildFinishCompletionPlan({
      requestedHome: 7,
      requestedAway: 5,
      liveHome: 7,
      liveAway: 5,
      scoreLogIsComplete: false,
      log: [],
      summary: 'Strong finish.',
      sendEmail: true,
      teamId: 'team-1',
      gameId: 'game-9',
      teamName: 'Tigers',
      opponentName: 'Bears',
      recipientEmail: 'team-notify@example.com',
      columns: ['PTS'],
      roster: [],
      statsByPlayerId: {},
      opponentEntries: [],
      buildEmailBody: (finalHome, finalAway, summary) => `Final ${finalHome}-${finalAway}\n${summary}`
    });

    expect(plan.navigation).toEqual([
      {
        type: 'mailto',
        href: 'mailto:team-notify@example.com?subject=Tigers%20vs%20Bears%20-%20Game%20Summary&body=Final%207-5%0AStrong%20finish.',
        delayMs: 0
      },
      {
        type: 'redirect',
        href: 'game.html#teamId=team-1&gameId=game-9',
        delayMs: 500
      }
    ]);
  });

  it('uses the coach-entered final score for recap generation when it corrects the live score', () => {
    let bodyArgs = null;
    const plan = buildFinishCompletionPlan({
      requestedHome: 44,
      requestedAway: 41,
      liveHome: 5,
      liveAway: 2,
      scoreLogIsComplete: true,
      log: [
        { text: 'Home layup', clock: '01:20', period: 'Q1', ts: 11, undoData: { type: 'stat', statKey: 'PTS', value: 2, isOpponent: false, playerId: 'p1' } },
        { text: 'Home three', clock: '00:40', period: 'Q1', ts: 12, undoData: { type: 'stat', statKey: 'PTS', value: 3, isOpponent: false, playerId: 'p2' } },
        { text: 'Away bucket', clock: '00:20', period: 'Q1', ts: 13, undoData: { type: 'stat', statKey: 'points', value: 2, isOpponent: true } }
      ],
      currentPeriod: 'Q4',
      currentClock: '00:00',
      summary: 'Closed well in the final minute.',
      sendEmail: true,
      teamId: 'team-1',
      gameId: 'game-9',
      teamName: 'Tigers',
      opponentName: 'Bears',
      recipientEmail: 'coach@example.com',
      columns: [],
      roster: [],
      statsByPlayerId: {},
      opponentEntries: [],
      buildEmailBody: (finalHome, finalAway, summary, logEntries) => {
        bodyArgs = { finalHome, finalAway, summary, logEntries };
        return 'body';
      }
    });

    expect(plan.navigation[0].href).toContain('body=body');
    expect(bodyArgs).toEqual({
      finalHome: 44,
      finalAway: 41,
      summary: 'Closed well in the final minute.',
      logEntries: [
        {
          text: 'Home layup',
          clock: '01:20',
          period: 'Q1',
          ts: 11,
          undoData: { type: 'stat', statKey: 'PTS', value: 2, isOpponent: false, playerId: 'p1' }
        },
        {
          text: 'Home three',
          clock: '00:40',
          period: 'Q1',
          ts: 12,
          undoData: { type: 'stat', statKey: 'PTS', value: 3, isOpponent: false, playerId: 'p2' }
        },
        {
          text: 'Away bucket',
          clock: '00:20',
          period: 'Q1',
          ts: 13,
          undoData: { type: 'stat', statKey: 'points', value: 2, isOpponent: true }
        }
      ]
    });
  });

  it('keeps the coach-entered final score when resumed data marks the score log incomplete', () => {
    const originalLog = [
      { text: 'Home bucket', clock: '05:10', period: 'Q1', ts: 11, undoData: { type: 'stat', statKey: 'PTS', value: 2, isOpponent: false, playerId: 'p1' } }
    ];

    const prepared = prepareFinishPlanForSave({
      finishPlanArgs: {
        requestedHome: 51,
        requestedAway: 48,
        liveHome: 51,
        liveAway: 48,
        scoreLogIsComplete: false,
        log: originalLog,
        summary: 'Closed it out.',
        sendEmail: false,
        teamId: 'team-1',
        gameId: 'game-9',
        teamName: 'Tigers',
        opponentName: 'Bears',
        recipientEmail: 'coach@example.com',
        columns: ['PTS'],
        roster: [],
        statsByPlayerId: {},
        opponentEntries: [],
        buildEmailBody: () => 'unused body'
      },
      period: 'Q4',
      clock: '00:00',
      now: () => 99
    });

    expect(prepared.addedReconciliationLogEntry).toBeNull();
    expect(prepared.updatedLog).toEqual(originalLog);
    expect(prepared.finishPlan.reconciliationNote).toBe('');
    expect(prepared.finishPlan.gameUpdate).toMatchObject({
      homeScore: 51,
      awayScore: 48,
      status: 'completed'
    });
  });

  it('wires the shared save-and-complete workflow through live tracker', () => {
    const source = readFileSync(new URL('../../js/live-tracker.js', import.meta.url), 'utf8');
    expect(source).toContain('runSaveAndCompleteWorkflow');
  });

  it('preserves accumulated playing time from .time field rather than writing 0 (regression: issue #2124)', () => {
    // live-tracker accumulates elapsed time in state.stats[id].time (not .timeMs).
    // Finalization must read .time so player playing-time is not zeroed out on game completion.
    const plan = buildFinishCompletionPlan({
      requestedHome: 10,
      requestedAway: 8,
      liveHome: 10,
      liveAway: 8,
      columns: ['PTS'],
      roster: [{ id: 'player-1', name: 'Jordan Smith', num: '23' }],
      statsByPlayerId: {
        'player-1': { time: 90000, timeMs: 0, pts: 12, fouls: 2 }
      },
      statTrackerConfig: {},
      teamId: 'team-1',
      gameId: 'game-1'
    });

    const playerWrite = plan.aggregatedStatsWrites.find(w => w.playerId === 'player-1');
    expect(playerWrite).toBeDefined();
    expect(playerWrite.data.timeMs).toBe(90000);
  });
});
