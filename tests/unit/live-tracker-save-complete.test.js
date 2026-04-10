import { describe, it, expect, vi } from 'vitest';
import { runSaveAndCompleteWorkflow } from '../../js/live-tracker-save-complete.js';

function buildDocRef(...args) {
  if (args.length === 1) {
    return { kind: 'auto-doc', path: `${args[0].path}/AUTO_ID` };
  }

  const [, ...segments] = args;
  return { kind: 'doc', path: segments.join('/') };
}

function buildHarness({ commitControl } = {}) {
  const setCalls = [];
  const updateCalls = [];
  const navigationCalls = [];
  const emailBodyCalls = [];
  const renderLog = vi.fn();
  const endLiveBroadcast = vi.fn(async () => {});

  const batch = {
    set: vi.fn((ref, data) => {
      setCalls.push({ ref, data });
    }),
    update: vi.fn((ref, data) => {
      updateCalls.push({ ref, data });
    }),
    commit: vi.fn(() => {
      if (commitControl?.promise) {
        return commitControl.promise;
      }

      return Promise.resolve();
    })
  };

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
    createBatch: vi.fn(() => batch),
    createCollectionRef: vi.fn((db, path) => ({ db, path })),
    createDocRef: vi.fn(buildDocRef),
    executeFinishNavigationPlan: vi.fn((navigation) => {
      navigationCalls.push(navigation);
    }),
    alertFn: vi.fn()
  };

  return {
    context,
    batch,
    setCalls,
    updateCalls,
    navigationCalls,
    emailBodyCalls,
    renderLog,
    endLiveBroadcast
  };
}

describe('live tracker save-and-complete workflow', () => {
  it('persists reconciled final scores, completes live status, and composes email from reconciled totals', async () => {
    const harness = buildHarness();

    const result = await runSaveAndCompleteWorkflow(harness.context);

    expect(result).toMatchObject({
      skipped: false,
      finalHome: 5,
      finalAway: 2
    });
    expect(harness.context.homeFinalInput.value).toBe('5');
    expect(harness.context.awayFinalInput.value).toBe('2');
    expect(harness.renderLog).toHaveBeenCalledTimes(1);
    expect(harness.batch.commit).toHaveBeenCalledTimes(1);
    expect(harness.endLiveBroadcast).toHaveBeenCalledTimes(1);
    expect(harness.updateCalls).toEqual([
      {
        ref: { kind: 'doc', path: 'teams/team-1/games/game-9' },
        data: {
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
        }
      }
    ]);
    expect(harness.emailBodyCalls).toHaveLength(2);
    expect(harness.emailBodyCalls.at(-1)).toEqual({
      finalHome: 5,
      finalAway: 2,
      summary: 'Closed well in the final minute.',
      logEntries: [
        {
          text: 'Score reconciled from 44-41 to 5-2 based on scoring events',
          ts: expect.any(Number),
          period: 'Q4',
          clock: '00:00'
        },
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
        href: 'mailto:team-notify@example.com?subject=Tigers%20vs%20Bears%20-%20Game%20Summary&body=Final%205-2%0AClosed%20well%20in%20the%20final%20minute.',
        delayMs: 0
      },
      {
        type: 'redirect',
        href: 'game.html#teamId=team-1&gameId=game-9',
        delayMs: 500
      }
    ]);
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
      finalHome: 5,
      finalAway: 2
    });
    expect(harness.context.finishButton.disabled).toBe(true);
    expect(harness.endLiveBroadcast).toHaveBeenCalledTimes(1);
    expect(harness.navigationCalls).toHaveLength(1);
  });
});
