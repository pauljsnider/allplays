import { describe, it, expect } from 'vitest';
import {
  applySubstitution,
  canApplySubstitution,
  canTrustScoreLogForFinalization,
  reconcileFinalScoreFromLog,
  deriveScoreFromLog,
  acquireSingleFlightLock,
  releaseSingleFlightLock
} from '../../js/live-tracker-integrity.js';
import {
  OVERTIME_MIXED_SCORING_LOG,
  EMPTY_OR_NON_SCORING_LOG,
  ZERO_VALUE_SCORING_LOG
} from './fixtures/live-tracker-score-log.fixtures.js';

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

  it('derives score totals from mixed scoring aliases used across overtime logs', () => {
    const derived = deriveScoreFromLog(OVERTIME_MIXED_SCORING_LOG);
    expect(derived).toEqual({ home: 5, away: 1 });
  });

  it('ignores non-scoring and malformed entries while deriving totals', () => {
    const log = [
      ...OVERTIME_MIXED_SCORING_LOG,
      {},
      { undoData: null },
      { undoData: { type: 'stat', statKey: 'PTS', value: 'not-a-number', isOpponent: true } }
    ];

    const derived = deriveScoreFromLog(log);
    expect(derived).toEqual({ home: 5, away: 1 });
  });

  it('does not trust score log when only zero-value scoring events exist', () => {
    expect(canTrustScoreLogForFinalization({
      liveHome: 0,
      liveAway: 0,
      log: ZERO_VALUE_SCORING_LOG
    })).toBe(false);
  });

  it('treats invalid requested scores as zero when reconciling', () => {
    const result = reconcileFinalScoreFromLog({
      requestedHome: undefined,
      requestedAway: 'NaN',
      log: EMPTY_OR_NON_SCORING_LOG
    });

    expect(result.mismatch).toBe(false);
    expect(result.home).toBe(0);
    expect(result.away).toBe(0);
  });

  it('flags mismatch when requested scores differ from derived overtime totals', () => {
    const result = reconcileFinalScoreFromLog({
      requestedHome: 4,
      requestedAway: 1,
      log: OVERTIME_MIXED_SCORING_LOG
    });

    expect(result.mismatch).toBe(true);
    expect(result.home).toBe(5);
    expect(result.away).toBe(1);
  });

  it('returns false when acquiring lock with missing lock object', () => {
    expect(acquireSingleFlightLock(null)).toBe(false);
  });

  it('releasing a missing lock is a safe no-op', () => {
    expect(() => releaseSingleFlightLock(null)).not.toThrow();
  });

  it('returns unchanged arrays when substitution input arrays are invalid', () => {
    const result = applySubstitution(null, undefined, 'p1', 'p2');
    expect(result).toEqual({ applied: false, onCourt: [], bench: [] });
  });

  it('can apply substitution when outgoing player is on court and incoming is not', () => {
    expect(canApplySubstitution(['p1', 'p2', 'p3', 'p4', 'p5'], 'p4', 'p8')).toBe(true);
  });

  it('allows only one finish submission at a time and supports retry after release', () => {
    const lock = { active: false };

    expect(acquireSingleFlightLock(lock)).toBe(true);
    expect(acquireSingleFlightLock(lock)).toBe(false);

    releaseSingleFlightLock(lock);
    expect(acquireSingleFlightLock(lock)).toBe(true);
  });
});
