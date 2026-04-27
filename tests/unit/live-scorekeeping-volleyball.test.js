import { describe, it, expect } from 'vitest';
import {
  applyVolleyballServeOutcome,
  createVolleyballUndoState,
  getDefaultVolleyballState,
  getVolleyballSetLabels,
  isVolleyballSport,
  restoreVolleyballUndoState
} from '../../js/live-scorekeeping-volleyball.js';

describe('volleyball live scorekeeping', () => {
  it('defaults to set one and home serving', () => {
    expect(isVolleyballSport('Volleyball')).toBe(true);
    expect(isVolleyballSport('Basketball')).toBe(false);
    expect(getVolleyballSetLabels()).toEqual(['Set 1', 'Set 2', 'Set 3', 'Set 4', 'Set 5']);
    expect(getDefaultVolleyballState()).toEqual({
      homeScore: 0,
      awayScore: 0,
      servingTeam: 'home',
      period: 'Set 1'
    });
  });

  it('keeps the serving team on an ace', () => {
    const result = applyVolleyballServeOutcome({ homeScore: 2, awayScore: 1, servingTeam: 'home' }, 'ace');

    expect(result.homeScore).toBe(3);
    expect(result.awayScore).toBe(1);
    expect(result.servingTeam).toBe('home');
    expect(result.sideOut).toBe(false);
    expect(result.description).toBe('Home ace: 3-1');
  });

  it('switches the serving team after a side-out service error', () => {
    const result = applyVolleyballServeOutcome({ homeScore: 7, awayScore: 4, servingTeam: 'home' }, 'service_error');

    expect(result.homeScore).toBe(7);
    expect(result.awayScore).toBe(5);
    expect(result.servingTeam).toBe('away');
    expect(result.sideOut).toBe(true);
  });

  it('awards rally points and moves serve to the rally winner', () => {
    const homePoint = applyVolleyballServeOutcome({ homeScore: 10, awayScore: 10, servingTeam: 'away' }, 'home_point');
    const awayPoint = applyVolleyballServeOutcome(homePoint, 'away_point');

    expect(homePoint.homeScore).toBe(11);
    expect(homePoint.awayScore).toBe(10);
    expect(homePoint.servingTeam).toBe('home');
    expect(homePoint.sideOut).toBe(true);

    expect(awayPoint.homeScore).toBe(11);
    expect(awayPoint.awayScore).toBe(11);
    expect(awayPoint.servingTeam).toBe('away');
    expect(awayPoint.sideOut).toBe(true);
  });

  it('captures and restores previous volleyball state for undo', () => {
    const before = { homeScore: 7, awayScore: 4, servingTeam: 'home', period: 'Set 2' };
    const after = applyVolleyballServeOutcome(before, 'service_error');
    const undoState = createVolleyballUndoState(before, after);

    expect(undoState.before).toEqual(before);
    expect(undoState.after).toEqual({
      homeScore: 7,
      awayScore: 5,
      servingTeam: 'away',
      period: 'Set 2'
    });
    expect(restoreVolleyballUndoState({ type: 'volleyball', ...undoState })).toEqual(before);
  });

  it('does not restore malformed volleyball undo data', () => {
    expect(restoreVolleyballUndoState({ type: 'volleyball' })).toBeNull();
    expect(restoreVolleyballUndoState({ type: 'stat', before: { homeScore: 1 } })).toBeNull();
  });
});
