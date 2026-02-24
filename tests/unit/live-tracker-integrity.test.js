import { describe, it, expect } from 'vitest';
import {
  applySubstitution,
  canApplySubstitution,
  canTrustScoreLogForFinalization,
  reconcileFinalScoreFromLog
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
});
