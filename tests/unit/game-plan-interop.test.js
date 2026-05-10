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

  it('maps legacy game-plan period-time-position shape to period-position', () => {
    const plan = buildRotationPlanFromGamePlan({
      numPeriods: 2,
      lineups: {
        '1-7-keeper': 'p1',
        '1-14-keeper': 'p2',
        '2-7-striker': 'p3'
      }
    });

    expect(plan).toEqual({
      H1: { keeper: 'p1' },
      H2: { striker: 'p3' }
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

  it('uses inning prefixes for baseball and softball legacy plans', () => {
    const baseballPlan = buildRotationPlanFromGamePlan({
      formationId: 'baseball-9',
      numPeriods: 7,
      lineups: {
        '1-1-p': 'p1',
        '2-1-ss': 'p2'
      }
    });
    expect(baseballPlan).toEqual({
      I1: { p: 'p1' },
      I2: { ss: 'p2' }
    });

    const softballPlan = buildRotationPlanFromGamePlan({
      formationId: 'softball-10',
      lineups: {
        'I1-lcf': 'p3'
      }
    });
    expect(softballPlan).toEqual({
      I1: { lcf: 'p3' }
    });
  });
});
