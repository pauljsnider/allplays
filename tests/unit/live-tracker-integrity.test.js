import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  applySubstitution,
  canApplySubstitution,
  canApplySubstitutionQueue,
  canApplyQueuedSubstitution,
  availableSubstitutionPlayers,
  removeQueuedSwap,
  buildSubstitutionHint,
  buildSubstitutionConfirm,
  canTrustScoreLogForFinalization,
  reconcileFinalScoreFromLog,
  resolveFinalScoreForCompletion,
  acquireSingleFlightLock,
  releaseSingleFlightLock
} from '../../js/live-tracker-integrity.js';

describe('live tracker integrity helpers', () => {
  it('rejects same-player substitution', () => {
    expect(canApplySubstitution(['p1', 'p2', 'p3', 'p4', 'p5'], 'p1', 'p1')).toBe(false);
  });

  it('rejects substitution when incoming player is already on court', () => {
    const result = applySubstitution(['p1', 'p2', 'p3', 'p4', 'p5'], ['p6', 'p7'], 'p1', 'p2');
    expect(result.applied).toBe(false);
    expect(result.onCourt).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
  });

  it('keeps onCourt unique after a valid substitution', () => {
    const result = applySubstitution(['p1', 'p2', 'p3', 'p4', 'p5'], ['p6', 'p7'], 'p1', 'p6');
    expect(result.applied).toBe(true);
    expect(new Set(result.onCourt).size).toBe(result.onCourt.length);
    expect(result.onCourt).toEqual(['p6', 'p2', 'p3', 'p4', 'p5']);
  });

  it('rejects substitution when outgoing player is not on court', () => {
    const result = applySubstitution(['p1', 'p2', 'p3', 'p4', 'p5'], ['p6', 'p7'], 'p9', 'p6');
    expect(result.applied).toBe(false);
    expect(result.onCourt).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(result.bench).toEqual(['p6', 'p7']);
  });

  it('moves outgoing player to bench and removes incoming player on valid substitution', () => {
    const result = applySubstitution(['p1', 'p2', 'p3', 'p4', 'p5'], ['p6', 'p7'], 'p1', 'p6');
    expect(result.applied).toBe(true);
    expect(result.bench).toContain('p1');
    expect(result.bench).not.toContain('p6');
  });

  it('rejects queued substitutions that reuse an incoming player after projection', () => {
    const onCourt = ['p1', 'p2', 'p3', 'p4', 'p5'];
    const bench = ['p6', 'p7'];

    expect(canApplySubstitutionQueue(onCourt, bench, [
      { out: 'p1', in: 'p6' },
      { out: 'p2', in: 'p6' }
    ])).toBe(false);

    expect(canApplyQueuedSubstitution(onCourt, bench, [
      { out: 'p1', in: 'p6' }
    ], 'p2', 'p6')).toBe(false);
  });

  it('allows queued substitutions when each swap is valid against projected lineup state', () => {
    expect(canApplySubstitutionQueue(
      ['p1', 'p2', 'p3', 'p4', 'p5'],
      ['p6', 'p7'],
      [
        { out: 'p1', in: 'p6' },
        { out: 'p2', in: 'p7' }
      ]
    )).toBe(true);
  });

  it('wires basketball queued substitutions through projected queue validation', () => {
    const basketballTrackerSource = readFileSync(new URL('../../js/track-basketball.js', import.meta.url), 'utf8');
    const applyQueueBody = basketballTrackerSource.match(/function applyQueue[\s\S]*?function subIn/)?.[0] || '';

    expect(basketballTrackerSource).toContain('canApplyQueuedSubstitution');
    expect(applyQueueBody).toContain('canApplySubstitutionQueue(state.onCourt, state.bench, state.subQueue)');
  });

  it('wires live tracker queued substitutions through projected queue validation', () => {
    const liveTrackerSource = readFileSync(new URL('../../js/live-tracker.js', import.meta.url), 'utf8');
    const queueSelectionBody = liveTrackerSource.match(/els\.subIn\.addEventListener[\s\S]*?els\.subConfirm\.addEventListener/)?.[0] || '';
    const applyQueueBody = liveTrackerSource.match(/function applyQueue[\s\S]*?function subIn/)?.[0] || '';
    const queueGuardIndex = applyQueueBody.indexOf('canApplySubstitutionQueue(state.onCourt, state.bench, state.subQueue)');
    const historyIndex = applyQueueBody.indexOf('saveHistory(');

    expect(liveTrackerSource).toContain('canApplyQueuedSubstitution');
    expect(queueSelectionBody).toContain('canApplyPendingSubstitution()');
    expect(queueGuardIndex).toBeGreaterThanOrEqual(0);
    expect(historyIndex).toBeGreaterThan(queueGuardIndex);
    expect(applyQueueBody).toContain('Queued substitutions conflict. Fix the queue before applying.');
  });

  it('reconciles final score to event-derived score when mismatched', () => {
    const log = [
      { undoData: { type: 'stat', statKey: 'pts', value: 2, isOpponent: false } },
      { undoData: { type: 'stat', statKey: 'PTS', value: 3, isOpponent: false } },
      { undoData: { type: 'stat', statKey: 'points', value: 2, isOpponent: true } },
      { undoData: { type: 'stat', statKey: 'fouls', value: 1, isOpponent: false } }
    ];

    const result = reconcileFinalScoreFromLog({
      requestedHome: 4,
      requestedAway: 1,
      log
    });

    expect(result.mismatch).toBe(true);
    expect(result.home).toBe(5);
    expect(result.away).toBe(2);
    expect(result.derived.home).toBe(5);
    expect(result.derived.away).toBe(2);
  });

  it('counts run stats as scoring events for diamond sports', () => {
    const log = [
      { undoData: { type: 'stat', statKey: 'R', value: 1, isOpponent: false } },
      { undoData: { type: 'stat', statKey: 'runs', value: 2, isOpponent: true } },
      { undoData: { type: 'stat', statKey: 'H', value: 1, isOpponent: false } }
    ];

    expect(reconcileFinalScoreFromLog({
      requestedHome: 0,
      requestedAway: 0,
      log
    })).toMatchObject({
      home: 1,
      away: 2,
      mismatch: true
    });

    expect(canTrustScoreLogForFinalization({
      liveHome: 1,
      liveAway: 2,
      log
    })).toBe(true);
  });

  it('keeps requested final score when already aligned to event-derived score', () => {
    const log = [
      { undoData: { type: 'stat', statKey: 'PTS', value: 2, isOpponent: false } },
      { undoData: { type: 'stat', statKey: 'PTS', value: 1, isOpponent: true } }
    ];

    const result = reconcileFinalScoreFromLog({
      requestedHome: 2,
      requestedAway: 1,
      log
    });

    expect(result.mismatch).toBe(false);
    expect(result.home).toBe(2);
    expect(result.away).toBe(1);
  });

  it('keeps resumed final score when persisted data makes the score log incomplete', () => {
    const result = resolveFinalScoreForCompletion({
      requestedHome: 51,
      requestedAway: 48,
      liveHome: 51,
      liveAway: 48,
      log: [
        { undoData: { type: 'stat', statKey: 'PTS', value: 2, isOpponent: false } }
      ],
      scoreLogIsComplete: false
    });

    expect(result.reconciled).toBe(false);
    expect(result.mismatch).toBe(false);
    expect(result.home).toBe(51);
    expect(result.away).toBe(48);
  });

  it('keeps entered final score after a resumed game log is cleared', () => {
    const result = resolveFinalScoreForCompletion({
      requestedHome: 40,
      requestedAway: 39,
      liveHome: 40,
      liveAway: 39,
      log: [],
      scoreLogIsComplete: false
    });

    expect(result.reconciled).toBe(false);
    expect(result.home).toBe(40);
    expect(result.away).toBe(39);
  });

  it('keeps a coach-entered final score correction even when the score log is complete and trustworthy', () => {
    const result = resolveFinalScoreForCompletion({
      requestedHome: 4,
      requestedAway: 1,
      liveHome: 5,
      liveAway: 2,
      log: [
        { undoData: { type: 'stat', statKey: 'PTS', value: 2, isOpponent: false } },
        { undoData: { type: 'stat', statKey: 'PTS', value: 3, isOpponent: false } },
        { undoData: { type: 'stat', statKey: 'PTS', value: 2, isOpponent: true } }
      ],
      scoreLogIsComplete: true
    });

    expect(result.reconciled).toBe(false);
    expect(result.mismatch).toBe(false);
    expect(result.home).toBe(4);
    expect(result.away).toBe(1);
  });

  it('trusts score log when derived totals match live score and contains scoring events', () => {
    const log = [
      { undoData: { type: 'stat', statKey: 'PTS', value: 2, isOpponent: false } },
      { undoData: { type: 'stat', statKey: 'PTS', value: 3, isOpponent: true } }
    ];

    expect(canTrustScoreLogForFinalization({
      liveHome: 2,
      liveAway: 3,
      log
    })).toBe(true);
  });

  it('does not trust score log when live score includes points missing from log', () => {
    const log = [
      { undoData: { type: 'stat', statKey: 'PTS', value: 2, isOpponent: false } }
    ];

    expect(canTrustScoreLogForFinalization({
      liveHome: 10,
      liveAway: 0,
      log
    })).toBe(false);
  });

  it('does not trust score log when there are no scoring events', () => {
    const log = [
      { undoData: { type: 'stat', statKey: 'fouls', value: 1, isOpponent: false } },
      { undoData: { type: 'note' } }
    ];

    expect(canTrustScoreLogForFinalization({
      liveHome: 0,
      liveAway: 0,
      log
    })).toBe(false);
  });

  it('allows only one finish submission at a time and supports retry after release', () => {
    const lock = { active: false };

    expect(acquireSingleFlightLock(lock)).toBe(true);
    expect(acquireSingleFlightLock(lock)).toBe(false);

    releaseSingleFlightLock(lock);
    expect(acquireSingleFlightLock(lock)).toBe(true);
  });

  it('wires final score completion through the shared integrity helper in live tracker', () => {
    const liveTrackerSource = readFileSync(new URL('../../js/live-tracker.js', import.meta.url), 'utf8');
    const workflowSource = readFileSync(new URL('../../js/live-tracker-save-complete.js', import.meta.url), 'utf8');
    expect(liveTrackerSource).toContain('runSaveAndCompleteWorkflow');
    expect(workflowSource).toContain('scoreLogIsComplete: state.scoreLogIsComplete');
    expect(workflowSource).toContain('buildFinishCompletionPlan');
  });

  it('persists live lineup after quick and queued substitutions', () => {
    const liveTrackerSource = readFileSync(new URL('../../js/live-tracker.js', import.meta.url), 'utf8');
    const quickSubBody = liveTrackerSource.match(/function applySub\([\s\S]*?function applyQueue/)?.[0] || '';
    const queuedSubBody = liveTrackerSource.match(/function applyQueue[\s\S]*?function subIn/)?.[0] || '';

    expect(liveTrackerSource).toContain('function persistLiveLineup()');
    expect(quickSubBody).toContain('persistLiveLineup();');
    expect(queuedSubBody).toContain('persistLiveLineup();');
  });

  it('persists and broadcasts lineup after auto-fill starters', () => {
    const liveTrackerSource = readFileSync(new URL('../../js/live-tracker.js', import.meta.url), 'utf8');
    const autoFillBody = liveTrackerSource.match(/function autoFillStarters\([\s\S]*?function playerName/)?.[0] || '';

    expect(autoFillBody).toContain('persistLocalTrackerState();');
    expect(autoFillBody).toContain("broadcastLineupUpdate('Lineup auto-filled');");
  });
});

describe('queue multiple substitution UX (#5258)', () => {
  it('removes queued players from the pickable lists', () => {
    expect(availableSubstitutionPlayers(
      ['p1', 'p2', 'p3', 'p4', 'p5'],
      ['p6', 'p7'],
      [{ out: 'p1', in: 'p6' }]
    )).toEqual({ onCourt: ['p2', 'p3', 'p4', 'p5'], bench: ['p7'] });
  });

  it('leaves the lists untouched with an empty queue', () => {
    expect(availableSubstitutionPlayers(['p1', 'p2'], ['p6'], []))
      .toEqual({ onCourt: ['p1', 'p2'], bench: ['p6'] });
  });

  it('tolerates a missing queue', () => {
    expect(availableSubstitutionPlayers(['p1'], ['p6'], null))
      .toEqual({ onCourt: ['p1'], bench: ['p6'] });
  });

  it('removes one queued swap by index without mutating the queue', () => {
    const queue = [{ out: 'p1', in: 'p6' }, { out: 'p2', in: 'p7' }];
    expect(removeQueuedSwap(queue, 0)).toEqual([{ out: 'p2', in: 'p7' }]);
    expect(queue).toEqual([{ out: 'p1', in: 'p6' }, { out: 'p2', in: 'p7' }]);
    expect(removeQueuedSwap(queue, 5)).toEqual(queue);
  });

  it('names the selected out-player in the queue-mode hint', () => {
    expect(buildSubstitutionHint({ queueMode: true, pendingOut: 'p1', pendingOutLabel: '#8 Hayes Coppaken' }))
      .toBe('Now tap his replacement — #8 Hayes Coppaken');
  });

  it('asks for the out-player when starting from the bench', () => {
    expect(buildSubstitutionHint({ queueMode: true, pendingIn: 'p6' })).toBe('Now tap who comes out');
  });

  it('keeps the default hint with no selection in queue mode', () => {
    expect(buildSubstitutionHint({ queueMode: true })).toBe('Tap player on court, then tap replacement');
  });

  it('keeps the quick-mode hints unchanged', () => {
    expect(buildSubstitutionHint({ queueMode: false })).toBe('Tap player on court, then tap replacement');
    expect(buildSubstitutionHint({ queueMode: false, pendingOut: 'p1' })).toBe('Now tap bench player to swap in');
  });

  it('shows the queued count on Make Swap and disables it at zero', () => {
    expect(buildSubstitutionConfirm({ queueMode: true, queueLength: 0, pendingValid: false }))
      .toEqual({ label: 'Make Swap', disabled: true });
    expect(buildSubstitutionConfirm({ queueMode: true, queueLength: 1, pendingValid: false }))
      .toEqual({ label: 'Make Swap (1)', disabled: false });
    expect(buildSubstitutionConfirm({ queueMode: true, queueLength: 2, pendingValid: false }))
      .toEqual({ label: 'Make Swap (2)', disabled: false });
  });

  it('keeps Make Swap enabled while a pair is being built', () => {
    expect(buildSubstitutionConfirm({ queueMode: true, queueLength: 0, pendingValid: true }))
      .toEqual({ label: 'Make Swap', disabled: false });
  });

  it('keeps the quick-mode confirm unchanged', () => {
    expect(buildSubstitutionConfirm({ queueMode: false, pendingValid: false }))
      .toEqual({ label: 'Make Swap', disabled: true });
    expect(buildSubstitutionConfirm({ queueMode: false, pendingValid: true }))
      .toEqual({ label: 'Make Swap', disabled: false });
  });
});

describe('queue multiple substitution UX wiring (#5258)', () => {
  const liveTrackerSource = readFileSync(new URL('../../js/live-tracker.js', import.meta.url), 'utf8');

  it('filters queued players out of the substitution lists', () => {
    const renderBody = liveTrackerSource.match(/function renderSubPlayers\([\s\S]*?function closeSubModal/)?.[0] || '';
    expect(renderBody).toContain('availableSubstitutionPlayers(state.onCourt, state.bench, state.subQueue)');
    expect(renderBody).not.toContain('state.subQueue.some(pair => pair.out === id)');
    expect(renderBody).not.toContain('state.subQueue.some(pair => pair.in === id)');
  });

  it('renders a per-swap remove control and wires it to removeQueuedSwap', () => {
    const renderBody = liveTrackerSource.match(/function renderQueue\([\s\S]*?function autoFillStarters/)?.[0] || '';
    expect(renderBody).toContain('data-queue-remove');
    expect(liveTrackerSource).toContain('removeQueuedSwap(state.subQueue, Number(btn.dataset.queueRemove))');
  });

  it('completes a bench-first pair from the on-court list and toggles selection', () => {
    const subOutBody = liveTrackerSource.match(/els\.subOut\.addEventListener[\s\S]*?els\.subIn\.addEventListener/)?.[0] || '';
    expect(subOutBody).toContain('state.pendingIn && !state.pendingOut');
    expect(subOutBody).toContain('state.pendingOut = state.pendingOut === id ? null : id');
  });

  it('selects the incoming player first from the bench list', () => {
    const subInBody = liveTrackerSource.match(/els\.subIn\.addEventListener[\s\S]*?els\.subConfirm\.addEventListener/)?.[0] || '';
    expect(subInBody).toContain('state.queueMode && !state.pendingOut');
    expect(subInBody).toContain('state.pendingIn = state.pendingIn === id ? null : id');
  });

  it('drives the hint and confirm button from the shared helpers', () => {
    const integritySource = readFileSync(new URL('../../js/live-tracker-integrity.js', import.meta.url), 'utf8');
    expect(liveTrackerSource).toContain('buildSubstitutionHint({');
    expect(liveTrackerSource).toContain('buildSubstitutionConfirm({');
    expect(integritySource).toContain('Now tap who comes out');
  });

  it('greys out the confirm button while disabled', () => {
    const livePage = readFileSync(new URL('../../live-tracker.html', import.meta.url), 'utf8');
    expect(livePage).toContain('id="confirm-sub-mobile"');
    expect(livePage).toMatch(/id="confirm-sub-mobile"[^>]*disabled:opacity-50/);
  });
});
