import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyGoalSportScore, buildGoalSportEvent, resolveGoalSportScorer } from '../../js/live-scorekeeping-goal-sports.js';

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
      createdBy: 'user-1',
      player: { id: 'opp-7', name: 'Alex Kim', number: '11' }
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
      playerId: 'opp-7',
      playerName: null,
      playerNumber: '',
      opponentPlayerName: 'Alex Kim',
      opponentPlayerNumber: '11',
      homeScore: 1,
      awayScore: 2,
      createdBy: 'user-1'
    });
    expect(event.description).toBe('Away goal by Alex Kim (H2) — Header off corner');
  });

  it('updates scorer player stats when recording a simple goal sport goal', () => {
    const html = readFileSync(new URL('../../track-live.html', import.meta.url), 'utf8');

    expect(html).toContain('resolveGoalSportScorer');
    expect(html).toContain('const scorerPlayer = applyRecordedGoalSportScorerStat(teamSide, scorer);');
    expect(html).toContain('gameState.playerStats');
    expect(html).toContain('schedulePlayerStatsSync(scorerPlayer.id);');
    expect(html).toContain('scheduleOpponentStatsSync();');
    expect(html).toContain('player: scorerPlayer');
  });

  it('resolves scorer text to roster players by name or jersey number', () => {
    const players = [
      { id: 'p1', name: 'Alex Kim', number: '8' },
      { id: 'p2', name: 'Sam Rivera', number: '11' }
    ];

    expect(resolveGoalSportScorer(players, ' alex   kim ')?.id).toBe('p1');
    expect(resolveGoalSportScorer(players, '#11')?.id).toBe('p2');
    expect(resolveGoalSportScorer(players, 'Unknown')).toBeNull();
  });
});
