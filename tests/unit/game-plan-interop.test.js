import { describe, it, expect } from 'vitest';
import { buildRotationPlanFromGamePlan } from '../../js/game-plan-interop.js';

describe('game plan interop helpers', () => {
  it('reads current game-day lineups shape', () => {
    const plan = buildRotationPlanFromGamePlan({
      lineups: {
        'H1-keeper': 'p1',
        'H1-striker': 'p2',
        'H2-keeper': 'p3'
      }
    });

    expect(plan).toEqual({
      H1: { keeper: 'p1', striker: 'p2' },
      H2: { keeper: 'p3' }
    });
  });

  it('consolidates legacy period-time-position keys by keeping the highest timeNum per position', () => {
    const plan = buildRotationPlanFromGamePlan({
      numPeriods: 2,
      lineups: {
        '1-7-keeper': 'p1',
        '1-14-keeper': 'p2',  // higher timeNum — should win for keeper in H1
        '1-21-keeper': 'p4',  // highest timeNum — wins for keeper in H1
        '2-7-striker': 'p3'
      }
    });

    expect(plan).toEqual({
      H1: { keeper: 'p4' },
      H2: { striker: 'p3' }
    });
  });

  it('round-trips saved Game Day substitution point labels', () => {
    const plan = buildRotationPlanFromGamePlan({
      lineups: {
        "H1 7'-keeper": 'p1',
        "H1 14'-keeper": 'p2'
      }
    });

    expect(plan).toEqual({
      "H1 7'": { keeper: 'p1' },
      "H1 14'": { keeper: 'p2' }
    });
  });

  it('uses quarter prefixes for 4-period legacy plans', () => {
    const plan = buildRotationPlanFromGamePlan({
      numPeriods: 4,
      lineups: {
        '1-4-pg': 'p1',
        '2-4-pg': 'p2'
      }
    });

    expect(plan).toEqual({
      Q1: { pg: 'p1' },
      Q2: { pg: 'p2' }
    });
  });

  it('prioritizes the latest player assignment (highest timeNum) for legacy data', () => {
    const gamePlan = {
      numPeriods: 2,
      lineups: {
        '1-10-F': 'playerA',
        '1-20-F': 'playerB',  // higher timeNum — should win
        '1-5-G': 'playerC',
        '1-15-G': 'playerD',  // higher timeNum — should win
      },
    };

    expect(buildRotationPlanFromGamePlan(gamePlan)).toEqual({
      H1: { F: 'playerB', G: 'playerD' },
    });
  });
});
