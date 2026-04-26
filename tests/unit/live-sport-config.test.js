import { describe, it, expect } from 'vitest';
import { getDefaultLivePeriod, getSportPeriodLabels } from '../../js/live-sport-config.js';

describe('live sport config helpers', () => {
  it('returns basketball defaults when sport is missing', () => {
    expect(getDefaultLivePeriod()).toBe('Q1');
    expect(getSportPeriodLabels()).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'OT']);
  });

  it('falls back to basketball-style labels for unsupported sports', () => {
    expect(getDefaultLivePeriod({ sport: 'Lacrosse' })).toBe('Q1');
    expect(getSportPeriodLabels({ sport: 'Lacrosse' })).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'OT']);
  });

  it('returns soccer half labels by sport', () => {
    expect(getDefaultLivePeriod({ sport: 'Soccer' })).toBe('H1');
    expect(getSportPeriodLabels({ sport: 'Soccer' })).toEqual(['H1', 'H2', 'ET1', 'ET2', 'PK']);
  });

  it('returns inning labels for baseball and softball', () => {
    expect(getDefaultLivePeriod({ sport: 'Baseball' })).toBe('T1');
    expect(getDefaultLivePeriod({ sport: 'Softball' })).toBe('T1');
    expect(getSportPeriodLabels({ sport: 'Baseball' })).toEqual(['T1', 'B1', 'T2', 'B2', 'T3', 'B3', 'T4', 'B4', 'T5', 'B5', 'T6', 'B6', 'T7', 'B7']);
  });

  it('prefers explicit config period labels over sport defaults', () => {
    expect(getDefaultLivePeriod({
      sport: 'Soccer',
      periods: [
        { label: '1st Half' },
        { label: '2nd Half' }
      ]
    })).toBe('1st Half');

    expect(getSportPeriodLabels({
      sport: 'Basketball',
      periods: [
        { label: 'Set 1' },
        { label: 'Set 2' }
      ]
    })).toEqual(['Set 1', 'Set 2']);
  });
});
