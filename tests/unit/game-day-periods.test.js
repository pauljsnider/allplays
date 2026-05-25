import { describe, expect, it } from 'vitest';
import { getPeriodsForFormation, sortSubstitutionPeriods } from '../../js/game-day-periods.js';

describe('game day period helpers', () => {
  it('returns formation-specific labels for halves, quarters, and innings', () => {
    expect(getPeriodsForFormation({ numPeriods: 2 })).toEqual(['H1', 'H2']);
    expect(getPeriodsForFormation({ numPeriods: 4 })).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
    expect(getPeriodsForFormation({ numPeriods: 7, periodPrefix: 'I' })).toEqual(['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7']);
  });

  it('sorts persisted substitution intervals by base period and minute', () => {
    const periods = ["H1 14'", "H1 7'", "H2 7'", "H1 21'"];

    expect(sortSubstitutionPeriods(periods)).toEqual(["H1 7'", "H1 14'", "H1 21'", "H2 7'"]);
  });

  it('does not mutate the caller period list', () => {
    const periods = ["Q1 8'", "Q1 4'"];

    expect(sortSubstitutionPeriods(periods)).toEqual(["Q1 4'", "Q1 8'"]);
    expect(periods).toEqual(["Q1 8'", "Q1 4'"]);
  });
});
