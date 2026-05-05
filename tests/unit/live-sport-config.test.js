import { describe, it, expect } from 'vitest';
import { getDefaultLivePeriod, getGoalSportProfile, getSportPeriodLabels, isGoalSport } from '../../js/live-sport-config.js';

describe('live sport config helpers', () => {
  it('returns basketball defaults when sport is missing', () => {
    expect(getDefaultLivePeriod()).toBe('Q1');
    expect(getSportPeriodLabels()).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'OT']);
  });

  it('returns soccer half labels by sport', () => {
    expect(getDefaultLivePeriod({ sport: 'Soccer' })).toBe('H1');
    expect(getSportPeriodLabels({ sport: 'Soccer' })).toEqual(['H1', 'H2', 'ET1', 'ET2', 'PK']);
  });

  it('maps supported goal sports to goal scorekeeper profiles', () => {
    expect(getGoalSportProfile({ sport: 'Soccer' })).toMatchObject({ sport: 'soccer', statColumns: ['GOALS'] });
    expect(getGoalSportProfile({ sport: 'Field Hockey' })).toMatchObject({ sport: 'field hockey', periodLabels: ['Q1', 'Q2', 'Q3', 'Q4', 'OT'] });
    expect(getGoalSportProfile({ sport: 'Hockey' })).toMatchObject({ sport: 'hockey', periodLabels: ['P1', 'P2', 'P3', 'OT', 'SO'] });
    expect(getGoalSportProfile({ sport: 'Lacrosse' })).toMatchObject({ sport: 'lacrosse', statColumns: ['GOALS'] });
    expect(getGoalSportProfile({ sport: 'Water Polo' })).toMatchObject({ sport: 'water polo', statColumns: ['GOALS'] });
    expect(getGoalSportProfile({ team: { sport: 'Custom' }, config: { baseType: 'Hockey' } })).toMatchObject({ sport: 'hockey' });
    expect(isGoalSport({ sport: 'Baseball' })).toBe(false);
  });

  it('uses goal sport period defaults beyond soccer', () => {
    expect(getDefaultLivePeriod({ sport: 'Field Hockey' })).toBe('Q1');
    expect(getDefaultLivePeriod({ sport: 'Hockey' })).toBe('P1');
    expect(getDefaultLivePeriod({ sport: 'Lacrosse' })).toBe('Q1');
    expect(getDefaultLivePeriod({ sport: 'Water Polo' })).toBe('Q1');
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
