import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildFinishCompletionPlan, prepareFinishPlanForSave } from '../../js/live-tracker-finish.js';

describe('live tracker finish completion plan', () => {
  it('reconciles the saved game outcome and persisted stats from the score log', () => {
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

    expect(plan.finalHome).toBe(5);
    expect(plan.finalAway).toBe(2);
    expect(plan.scoreReconciliation).toMatchObject({
      mismatch: true,
      derived: { home: 5, away: 2 }
    });
    expect(plan.reconciliationNote).toBe('Score reconciled from 44-41 to 5-2 based on scoring events');
    expect(plan.gameUpdate).toEqual({
      homeScore: 5,
      awayScore: 2,
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
          stats: { pts: 2, ast: 1, fouls: 0 },
          timeMs: 123000
        }
      },
      {
        playerId: 'p2',
        data: {
          playerName: 'Jamie',
          playerNumber: '7',
          stats: { pts: 3, ast: 0, fouls: 2 },
          timeMs: 118000
        }
      }
    ]);
    expect(plan.navigation).toEqual([
      { type: 'redirect', href: 'game.html#teamId=team-1&gameId=game-9', delayMs: 0 }
    ]);
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

  it('includes the reconciliation note in recap generation inputs when it is already present in the finish log', () => {
    let bodyArgs = null;
    const reconciliationLogEntry = {
      text: 'Score reconciled from 44-41 to 5-2 based on scoring events',
      ts: 99,
      period: 'Q4',
      clock: '00:00'
    };
    const plan = buildFinishCompletionPlan({
      requestedHome: 44,
      requestedAway: 41,
      liveHome: 5,
      liveAway: 2,
      scoreLogIsComplete: true,
      log: [
        reconciliationLogEntry,
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
      finalHome: 5,
      finalAway: 2,
      summary: 'Closed well in the final minute.',
      logEntries: [
        reconciliationLogEntry,
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
});
