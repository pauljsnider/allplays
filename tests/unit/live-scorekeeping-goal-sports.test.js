import { describe, expect, it } from 'vitest';
import { applyGoalSportScore, buildGoalSportEvent } from '../../js/live-scorekeeping-goal-sports.js';

describe('goal sport scorekeeping helpers', () => {
  it('increments the selected side by one goal', () => {
    expect(applyGoalSportScore({ homeScore: 1, awayScore: 2 }, 'home')).toEqual({
      homeScore: 2,
      awayScore: 2
    });
    expect(applyGoalSportScore({ homeScore: 1, awayScore: 2 }, 'away')).toEqual({
      homeScore: 1,
      awayScore: 3
    });
  });

  it('builds fan-visible goal events with period, side, scorer, and note', () => {
    const event = buildGoalSportEvent({
      teamSide: 'away',
      period: 'H2',
      scorer: 'Alex Kim',
      note: 'Header off corner',
      gameClockMs: 125000,
      homeScore: 1,
      awayScore: 2,
      createdBy: 'user-1'
    });

    expect(event).toMatchObject({
      type: 'goal',
      statKey: 'goals',
      value: 1,
      teamSide: 'away',
      isOpponent: true,
      period: 'H2',
      scorer: 'Alex Kim',
      note: 'Header off corner',
      playerName: null,
      opponentPlayerName: 'Alex Kim',
      homeScore: 1,
      awayScore: 2,
      createdBy: 'user-1'
    });
    expect(event.description).toBe('Away goal by Alex Kim (H2) — Header off corner');
  });
});
