import { describe, it, expect, vi } from 'vitest';
import { commitFinishPlan, runSaveAndCompleteWorkflow } from '../../js/live-tracker-save-complete.js';
import { hasPlayerProfileParticipation } from '../../js/player-profile-stats.js';

function buildDocRef(...args) {
  if (args.length === 1) {
    return { kind: 'auto-doc', path: `${args[0].path}/AUTO_ID` };
  }

  const [, ...segments] = args;
  return { kind: 'doc', path: segments.join('/') };
}

function buildHarness({ commitControl } = {}) {
  const setCalls = [];
  const deleteCalls = [];
  const updateCalls = [];
  const navigationCalls = [];
  const emailBodyCalls = [];
  const renderLog = vi.fn();
  const endLiveBroadcast = vi.fn(async () => {});

  const batches = [];
  const createBatch = vi.fn(() => {
    const batchIndex = batches.length;
    const batch = {
      set: vi.fn((ref, data) => {
        setCalls.push({ ref, data });
      }),
      update: vi.fn((ref, data) => {
        updateCalls.push({ ref, data });
      }),
      delete: vi.fn((ref) => {
        deleteCalls.push({ ref });
      }),
      commit: vi.fn(() => {
        if (batch.update.mock.calls.length > 0 && commitControl?.promise) {
          return commitControl.promise;
        }

        return Promise.resolve();
      })
    };
    batches.push(batch);
    return batch;
  });

  const context = {
    finishSubmissionLock: { active: false },
    finishButton: { disabled: false },
    homeFinalInput: { value: '44' },
    awayFinalInput: { value: '41' },
    notesFinalInput: { value: 'Closed well in the final minute.' },
    finishSendEmailInput: { checked: true },
    state: {
      home: 5,
      away: 2,
      scoreLogIsComplete: true,
      period: 'Q4',
      clock: 0,
      log: [
        { text: 'Home layup', clock: '01:20', period: 'Q1', ts: 11, undoData: { type: 'stat', statKey: 'PTS', value: 2, isOpponent: false, playerId: 'p1' } },
        { text: 'Home three', clock: '00:40', period: 'Q1', ts: 12, undoData: { type: 'stat', statKey: 'PTS', value: 3, isOpponent: false, playerId: 'p2' } },
        { text: 'Away bucket', clock: '00:20', period: 'Q1', ts: 13, undoData: { type: 'stat', statKey: 'points', value: 2, isOpponent: true } }
      ],
      stats: {
        p1: { pts: 2, ast: 1, fouls: 0, time: 123000 },
        p2: { pts: 3, ast: 0, fouls: 2, time: 118000 }
      },
      opp: [
        { id: 'opp-1', playerId: 'opp-1', name: 'Pat', number: '12', photoUrl: 'https://img/opp.jpg', stats: { pts: 2, ast: 0, fouls: 1 } }
      ]
    },
    currentTeam: { name: 'Tigers', notificationEmail: 'team-notify@example.com' },
    currentGame: { opponent: 'Bears' },
    currentUser: { uid: 'user-1', email: 'coach-login@example.com' },
    currentConfig: { columns: ['PTS', 'AST'] },
    currentTeamId: 'team-1',
    currentGameId: 'game-9',
    roster: [
      { id: 'p1', name: 'Alex', num: '4' },
      { id: 'p2', name: 'Jamie', num: '7' }
    ],
    db: { name: 'db' },
    renderLog,
    endLiveBroadcast,
    generateEmailBody: vi.fn((finalHome, finalAway, summary, logEntries) => {
      emailBodyCalls.push({ finalHome, finalAway, summary, logEntries });
      return `Final ${finalHome}-${finalAway}\n${summary}`;
    }),
    createBatch,
    createCollectionRef: vi.fn((db, path) => ({ db, path })),
    createDocRef: vi.fn(buildDocRef),
    executeFinishNavigationPlan: vi.fn((navigation) => {
      navigationCalls.push(navigation);
    }),
    alertFn: vi.fn()
  };

  return {
    context,
    get batch() {
      return batches.find((batch) => batch.update.mock.calls.length > 0) || batches[0];
    },
    batches,
    setCalls,
    deleteCalls,
    updateCalls,
    navigationCalls,
    emailBodyCalls,
    renderLog,
    endLiveBroadcast
  };
}

describe('live tracker save-and-complete workflow', () => {
  it('persists coach-entered final scores and composes email from corrected totals', async () => {
    const harness = buildHarness();

    const result = await runSaveAndCompleteWorkflow(harness.context);

    expect(result).toMatchObject({
      skipped: false,
      finalHome: 44,
      finalAway: 41
    });
    expect(harness.context.homeFinalInput.value).toBe('44');
    expect(harness.context.awayFinalInput.value).toBe('41');
    expect(harness.renderLog).not.toHaveBeenCalled();
    expect(harness.batch.commit).toHaveBeenCalledTimes(1);
    expect(harness.endLiveBroadcast).toHaveBeenCalledTimes(1);
    expect(harness.updateCalls).toEqual([
      {
        ref: { kind: 'doc', path: 'teams/team-1/games/game-9' },
        data: {
          homeScore: 44,
          awayScore: 41,
          summary: 'Closed well in the final minute.',
          status: 'completed',
          liveStatus: 'completed',
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
        }
      }
    ]);
    expect(harness.emailBodyCalls).toHaveLength(1);
    expect(harness.emailBodyCalls.at(-1)).toEqual({
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
    expect(harness.navigationCalls).toHaveLength(1);
    expect(harness.navigationCalls[0]).toEqual([
      {
        type: 'mailto',
        href: 'mailto:team-notify@example.com?subject=Tigers%20vs%20Bears%20-%20Game%20Summary&body=Final%2044-41%0AClosed%20well%20in%20the%20final%20minute.',
        delayMs: 0
      },
      {
        type: 'redirect',
        href: 'game.html#teamId=team-1&gameId=game-9',
        delayMs: 500
      }
    ]);
  });

  it('preserves lineup-only zero-stat appearances in finish writes', async () => {
    const harness = buildHarness();
    harness.context.state.stats = {
      'p-zero': { pts: 0, ast: 0, fouls: 0, time: 0 }
    };
    harness.context.state.onCourt = ['p-zero'];
    harness.context.state.subs = [];
    harness.context.roster = [
      { id: 'p-zero', name: 'Zero Stat', num: '12' }
    ];
    harness.context.currentConfig = { columns: ['PTS', 'AST'] };

    await runSaveAndCompleteWorkflow(harness.context);

    const zeroStatWrite = harness.setCalls.find(({ ref }) => ref.path === 'teams/team-1/games/game-9/aggregatedStats/p-zero');
    expect(zeroStatWrite).toEqual({
      ref: { kind: 'doc', path: 'teams/team-1/games/game-9/aggregatedStats/p-zero' },
      data: {
        playerName: 'Zero Stat',
        playerNumber: '12',
        timeMs: 0,
        participated: true,
        participationStatus: 'appeared',
        participationSource: 'live-tracker-finish',
        stats: { pts: 0, ast: 0, fouls: 0 }
      }
    });
  });

  it('preserves substitution-only zero-stat appearances in finish writes and player history visibility', async () => {
    const harness = buildHarness();
    harness.context.state.stats = {
      'p-zero': { pts: 0, ast: 0, fouls: 0, time: 0 },
      'p-other': { pts: 0, ast: 0, fouls: 0, time: 0 }
    };
    harness.context.state.onCourt = ['p-other'];
    harness.context.state.subs = [
      { out: 'p-other', in: 'p-zero' },
      { out: 'p-zero', in: 'p-other' }
    ];
    harness.context.roster = [
      { id: 'p-zero', name: 'Zero Stat', num: '12' },
      { id: 'p-other', name: 'Other Player', num: '3' }
    ];
    harness.context.currentConfig = { columns: ['PTS', 'AST'] };

    await runSaveAndCompleteWorkflow(harness.context);

    const zeroStatWrite = harness.setCalls.find(({ ref }) => ref.path === 'teams/team-1/games/game-9/aggregatedStats/p-zero');
    expect(zeroStatWrite).toEqual({
      ref: { kind: 'doc', path: 'teams/team-1/games/game-9/aggregatedStats/p-zero' },
      data: {
        playerName: 'Zero Stat',
        playerNumber: '12',
        timeMs: 0,
        participated: true,
        participationStatus: 'appeared',
        participationSource: 'live-tracker-finish',
        stats: { pts: 0, ast: 0, fouls: 0 }
      }
    });
    expect(hasPlayerProfileParticipation(zeroStatWrite.data)).toBe(true);
  });

  it('accepts only one in-flight finish submission and keeps the button disabled until commit settles', async () => {
    let resolveCommit;
    const commitControl = {};
    commitControl.promise = new Promise((resolve) => {
      resolveCommit = resolve;
    });

    const harness = buildHarness({ commitControl });

    const firstRun = runSaveAndCompleteWorkflow(harness.context);

    expect(harness.context.finishButton.disabled).toBe(true);
    expect(harness.batch.commit).toHaveBeenCalledTimes(1);

    const secondResult = await runSaveAndCompleteWorkflow(harness.context);
    expect(secondResult).toEqual({ skipped: true, reason: 'locked' });
    expect(harness.batch.commit).toHaveBeenCalledTimes(1);
    expect(harness.navigationCalls).toHaveLength(0);
    expect(harness.endLiveBroadcast).toHaveBeenCalledTimes(0);

    resolveCommit();
    const firstResult = await firstRun;

    expect(firstResult).toMatchObject({
      skipped: false,
      finalHome: 44,
      finalAway: 41
    });
    expect(harness.context.finishButton.disabled).toBe(true);
    expect(harness.endLiveBroadcast).toHaveBeenCalledTimes(1);
    expect(harness.navigationCalls).toHaveLength(1);
  });

  it('allows failed finalization commits to be converted into pending offline sync without a hard alert', async () => {
    const harness = buildHarness();
    const offlineError = new Error('offline');
    const beforeFinalizationCommit = vi.fn(async () => {
      throw offlineError;
    });
    const onCommitFailure = vi.fn(() => ({ pending: true }));

    const result = await runSaveAndCompleteWorkflow({
      ...harness.context,
      beforeFinalizationCommit,
      onCommitFailure
    });

    expect(result).toMatchObject({
      skipped: false,
      pending: true,
      finalHome: 44,
      finalAway: 41,
      error: offlineError
    });
    expect(beforeFinalizationCommit).toHaveBeenCalledWith({
      finishPlan: expect.objectContaining({
        finalHome: 44,
        finalAway: 41,
        gameUpdate: expect.objectContaining({ status: 'completed', liveStatus: 'completed' })
      })
    });
    expect(onCommitFailure).toHaveBeenCalledWith({
      error: offlineError,
      finishPlan: expect.objectContaining({
        finalHome: 44,
        finalAway: 41,
        gameUpdate: expect.objectContaining({ status: 'completed', liveStatus: 'completed' })
      })
    });
    expect(harness.batches).toHaveLength(0);
    expect(harness.context.alertFn).not.toHaveBeenCalled();
    expect(harness.context.finishButton.disabled).toBe(false);
    expect(harness.endLiveBroadcast).not.toHaveBeenCalled();
    expect(harness.navigationCalls).toHaveLength(0);
  });

  it('can replay a stored finalization plan into a fresh Firestore batch', async () => {
    const harness = buildHarness();
    const finishPlan = {
      eventWrites: [
        { data: { text: 'Home layup', gameTime: '01:20' } }
      ],
      aggregatedStatsWrites: [
        { playerId: 'p1', data: { playerName: 'Alex', stats: { pts: 2 }, timeMs: 1000 } }
      ],
      gameUpdate: {
        homeScore: 2,
        awayScore: 0,
        status: 'completed'
      }
    };

    await commitFinishPlan({
      finishPlan,
      db: harness.context.db,
      currentTeamId: 'team-1',
      currentGameId: 'game-9',
      createBatch: harness.context.createBatch,
      createCollectionRef: harness.context.createCollectionRef,
      createDocRef: harness.context.createDocRef
    });

    expect(harness.batch.commit).toHaveBeenCalledTimes(1);
    expect(harness.setCalls).toEqual([
      {
        ref: { kind: 'doc', path: 'teams/team-1/games/game-9/events/finish-log-000001' },
        data: { text: 'Home layup', gameTime: '01:20' }
      },
      {
        ref: { kind: 'doc', path: 'teams/team-1/games/game-9/aggregatedStats/p1' },
        data: { playerName: 'Alex', stats: { pts: 2 }, timeMs: 1000 }
      }
    ]);
    expect(harness.deleteCalls).toEqual([
      {
        ref: { kind: 'doc', path: 'teams/team-1/games/game-9/privatePlayerStats/p1' }
      }
    ]);
    expect(harness.updateCalls).toEqual([
      {
        ref: { kind: 'doc', path: 'teams/team-1/games/game-9' },
        data: {
          homeScore: 2,
          awayScore: 0,
          status: 'completed'
        }
      }
    ]);
  });
});
