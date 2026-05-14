import { buildRotationPlanFromGamePlan } from '../../js/game-plan-interop.js';
import assert from 'assert';

describe('buildRotationPlanFromGamePlan', () => {
  it('should prioritize the latest player assignment (highest timeNum) for legacy data', () => {
    const gamePlan = {
      numPeriods: 2,
      lineups: {
        '1-10-F': 'playerA',
        '1-20-F': 'playerB', // This should be prioritized
        '1-5-G': 'playerC',
        '1-15-G': 'playerD', // This should be prioritized
      },
    };

    const rotationPlan = buildRotationPlanFromGamePlan(gamePlan);

    const expectedPlan = {
      'H1': {
        'F': 'playerB',
        'G': 'playerD',
      },
    };

    assert.deepStrictEqual(rotationPlan, expectedPlan);
  });
});
