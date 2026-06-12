import { describe, it, expect } from 'vitest';
import {
  buildRotationPlanFromGamePlan,
  normalizeLineupsForGamePlanPlanner
} from '../../js/game-plan-interop.js';

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

  it('preserves legacy period-time-position keys as substitution point labels', () => {
    const plan = buildRotationPlanFromGamePlan({
      numPeriods: 2,
      lineups: {
        '1-7-keeper': 'p1',
        '1-14-keeper': 'p2',
        '1-21-keeper': 'p4',
        '2-7-striker': 'p3'
      }
    });

    expect(plan).toEqual({
      "H1 7'": { keeper: 'p1' },
      "H1 14'": { keeper: 'p2' },
      "H1 21'": { keeper: 'p4' },
      "H2 7'": { striker: 'p3' }
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

  it('maps Game Day half lineup keys into planner interval keys', () => {
    const lineups = normalizeLineupsForGamePlanPlanner({
      numPeriods: 2,
      periodDuration: 25,
      subTimes: [7, 14, 21],
      lineups: {
        'H1-keeper': 'p1',
        'H2-striker': 'p2'
      }
    });

    expect(lineups).toEqual({
      '1-7-keeper': 'p1',
      '2-7-striker': 'p2'
    });
  });

  it('lets existing planner keys override older Game Day keys for the same cell', () => {
    const lineups = normalizeLineupsForGamePlanPlanner({
      numPeriods: 2,
      periodDuration: 25,
      subTimes: [7, 14, 21],
      lineups: {
        'H1-keeper': 'old-player',
        '1-7-keeper': 'new-player'
      }
    });

    expect(lineups).toEqual({
      '1-7-keeper': 'new-player'
    });
  });

  it('maps saved Game Day substitution labels into matching planner interval keys', () => {
    const lineups = normalizeLineupsForGamePlanPlanner({
      numPeriods: 2,
      periodDuration: 25,
      subTimes: [7, 14, 21],
      lineups: {
        "H1 14'-keeper": 'p2'
      }
    });

    expect(lineups).toEqual({
      '1-14-keeper': 'p2'
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
      "Q1 4'": { pg: 'p1' },
      "Q2 4'": { pg: 'p2' }
    });
  });

  it('preserves inning labels and maps legacy 7-period plans to innings', () => {
    expect(buildRotationPlanFromGamePlan({
      numPeriods: 7,
      periodPrefix: 'I',
      lineups: {
        'I1-pitcher': 'p1',
        'I7-catcher': 'p2',
        '2-full-first-base': 'p3',
        '3-1-shortstop': 'p4'
      }
    })).toEqual({
      I1: { pitcher: 'p1' },
      I7: { catcher: 'p2' },
      I2: { 'first-base': 'p3' },
      I3: { shortstop: 'p4' }
    });
  });

  it('maps saved inning lineup keys into planner interval keys', () => {
    const lineups = normalizeLineupsForGamePlanPlanner({
      numPeriods: 7,
      periodPrefix: 'I',
      periodDuration: 1,
      subTimes: [],
      lineups: {
        'I1-pitcher': 'p1',
        'I3-catcher': 'p2'
      }
    });

    expect(lineups).toEqual({
      '1-full-pitcher': 'p1',
      '3-full-catcher': 'p2'
    });
  });

  it('keeps every legacy substitution slot for the same period and position', () => {
    const gamePlan = {
      numPeriods: 2,
      lineups: {
        '1-10-F': 'playerA',
        '1-20-F': 'playerB',
        '1-5-G': 'playerC',
        '1-15-G': 'playerD',
      },
    };

    expect(buildRotationPlanFromGamePlan(gamePlan)).toEqual({
      "H1 5'": { G: 'playerC' },
      "H1 10'": { F: 'playerA' },
      "H1 15'": { G: 'playerD' },
      "H1 20'": { F: 'playerB' },
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
