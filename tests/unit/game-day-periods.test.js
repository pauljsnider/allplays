import { describe, expect, it } from 'vitest';
import { sortSubstitutionPeriods } from '../../js/game-day-periods.js';

describe('game day period helpers', () => {
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
