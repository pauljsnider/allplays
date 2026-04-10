import { describe, expect, it } from 'vitest';
import { computeNativeStandings } from '../../js/native-standings.js';

const SAMPLE_GAMES = [
  { homeTeam: 'Tigers', awayTeam: 'Lions', homeScore: 10, awayScore: 7, status: 'completed' },
  { homeTeam: 'Lions', awayTeam: 'Bears', homeScore: 14, awayScore: 3, status: 'completed' },
  { homeTeam: 'Bears', awayTeam: 'Tigers', homeScore: 12, awayScore: 2, status: 'completed' },
  { homeTeam: 'Tigers', awayTeam: 'Bears', homeScore: 8, awayScore: 8, status: 'completed' }
];

describe('computeNativeStandings', () => {
  it('ranks by points when ranking mode is points', () => {
    const table = computeNativeStandings(SAMPLE_GAMES, {
      rankingMode: 'points',
      points: { win: 3, tie: 1, loss: 0 }
    });

    expect(table.map((row) => row.team)).toEqual(['Bears', 'Tigers', 'Lions']);
    expect(table[0]).toMatchObject({ points: 4, record: '1-1-1' });
    expect(table[1]).toMatchObject({ points: 4, record: '1-1-1' });
    expect(table[2]).toMatchObject({ points: 3, record: '1-1' });
  });

  it('ranks by win percentage when ranking mode is win_pct', () => {
    const table = computeNativeStandings(SAMPLE_GAMES, {
      rankingMode: 'win_pct',
      tiebreakers: ['point_diff']
    });

    expect(table.map((row) => row.team)).toEqual(['Lions', 'Bears', 'Tigers']);
    expect(table[0].winPct).toBeCloseTo(0.5, 5);
    expect(table[1].winPct).toBeCloseTo(0.5, 5);
  });

  it('applies ordered tiebreakers in order', () => {
    const games = [
      { homeTeam: 'Alpha', awayTeam: 'Bravo', homeScore: 10, awayScore: 7, status: 'completed' },
      { homeTeam: 'Bravo', awayTeam: 'Alpha', homeScore: 30, awayScore: 0, status: 'completed' },
      { homeTeam: 'Alpha', awayTeam: 'Comets', homeScore: 21, awayScore: 7, status: 'completed' },
      { homeTeam: 'Bravo', awayTeam: 'Comets', homeScore: 14, awayScore: 0, status: 'completed' }
    ];

    const table = computeNativeStandings(games, {
      rankingMode: 'points',
      points: { win: 2, tie: 1, loss: 0 },
      tiebreakers: ['head_to_head', 'point_diff', 'name']
    });

    expect(table[0].team).toBe('Bravo');
    expect(table[1].team).toBe('Alpha');
    expect(table[0].points).toBe(table[1].points);
  });

  it('returns deterministic name ordering as final fallback', () => {
    const games = [
      { homeTeam: 'Beta', awayTeam: 'Alpha', homeScore: 7, awayScore: 7, status: 'completed' }
    ];

    const table = computeNativeStandings(games, {
      rankingMode: 'points',
      points: { win: 2, tie: 1, loss: 0 },
      tiebreakers: []
    });

    expect(table.map((row) => row.team)).toEqual(['Alpha', 'Beta']);
  });

  it('counts only explicitly completed or final games', () => {
    const games = [
      { homeTeam: 'Alpha', awayTeam: 'Bravo', homeScore: 3, awayScore: 0, status: 'completed' },
      { homeTeam: 'Alpha', awayTeam: 'Bravo', homeScore: 0, awayScore: 0 }
    ];

    const table = computeNativeStandings(games, {
      rankingMode: 'points',
      points: { win: 3, tie: 1, loss: 0 }
    });

    expect(table.find((row) => row.team === 'Alpha')).toMatchObject({ gp: 1, points: 3, record: '1-0' });
    expect(table.find((row) => row.team === 'Bravo')).toMatchObject({ gp: 1, points: 0, record: '0-1' });
  });

  it('uses only completed games for head-to-head tiebreakers', () => {
    const games = [
      { homeTeam: 'Alpha', awayTeam: 'Bravo', homeScore: 10, awayScore: 0, status: 'completed' },
      { homeTeam: 'Alpha', awayTeam: 'Comets', homeScore: 8, awayScore: 1, status: 'completed' },
      { homeTeam: 'Bravo', awayTeam: 'Comets', homeScore: 7, awayScore: 0, status: 'completed' },
      { homeTeam: 'Bravo', awayTeam: 'Alpha', homeScore: 50, awayScore: 0, status: 'live' }
    ];

    const table = computeNativeStandings(games, {
      rankingMode: 'points',
      points: { win: 2, tie: 1, loss: 0 },
      tiebreakers: ['head_to_head', 'point_diff', 'name']
    });

    expect(table[0].team).toBe('Alpha');
    expect(table[1].team).toBe('Bravo');
  });

  it('caps goal differential without changing raw goals for and against', () => {
    const games = [
      { homeTeam: 'Alpha', awayTeam: 'Bravo', homeScore: 10, awayScore: 0, status: 'completed' }
    ];

    const table = computeNativeStandings(games, {
      rankingMode: 'points',
      points: { win: 3, tie: 1, loss: 0 },
      maxGoalDiff: 3,
      tiebreakers: ['point_diff', 'name']
    });

    expect(table.find((row) => row.team === 'Alpha')).toMatchObject({
      pf: 10,
      pa: 0,
      pd: 3,
      points: 3
    });
    expect(table.find((row) => row.team === 'Bravo')).toMatchObject({
      pf: 0,
      pa: 10,
      pd: -3,
      points: 0
    });
  });

  it('resolves multi-team ties with group head-to-head before overall point differential', () => {
    const games = [
      { homeTeam: 'Alpha', awayTeam: 'Bravo', homeScore: 1, awayScore: 0, status: 'completed' },
      { homeTeam: 'Alpha', awayTeam: 'Comets', homeScore: 1, awayScore: 0, status: 'completed' },
      { homeTeam: 'Dragons', awayTeam: 'Alpha', homeScore: 1, awayScore: 0, status: 'completed' },
      { homeTeam: 'Eagles', awayTeam: 'Alpha', homeScore: 1, awayScore: 0, status: 'completed' },
      { homeTeam: 'Bravo', awayTeam: 'Comets', homeScore: 1, awayScore: 0, status: 'completed' },
      { homeTeam: 'Bravo', awayTeam: 'Dragons', homeScore: 4, awayScore: 0, status: 'completed' },
      { homeTeam: 'Eagles', awayTeam: 'Bravo', homeScore: 1, awayScore: 0, status: 'completed' },
      { homeTeam: 'Comets', awayTeam: 'Dragons', homeScore: 10, awayScore: 0, status: 'completed' },
      { homeTeam: 'Comets', awayTeam: 'Falcons', homeScore: 10, awayScore: 0, status: 'completed' },
      { homeTeam: 'Eagles', awayTeam: 'Comets', homeScore: 1, awayScore: 0, status: 'completed' }
    ];

    const table = computeNativeStandings(games, {
      rankingMode: 'points',
      points: { win: 3, tie: 1, loss: 0 },
      twoTeamTiebreakers: ['head_to_head', 'point_diff', 'name'],
      multiTeamTiebreakers: ['group_head_to_head', 'point_diff', 'name']
    });

    expect(table.slice(1, 4).map((row) => row.team)).toEqual(['Alpha', 'Bravo', 'Comets']);
    expect(table.find((row) => row.team === 'Comets').pd).toBeGreaterThan(table.find((row) => row.team === 'Alpha').pd);
  });

  it('uses the two-team tiebreaker stack when the new config shape is present', () => {
    const games = [
      { homeTeam: 'Alpha', awayTeam: 'Comets', homeScore: 1, awayScore: 0, status: 'completed' },
      { homeTeam: 'Bravo', awayTeam: 'Alpha', homeScore: 1, awayScore: 0, status: 'completed' },
      { homeTeam: 'Comets', awayTeam: 'Bravo', homeScore: 5, awayScore: 0, status: 'completed' },
      { homeTeam: 'Alpha', awayTeam: 'Dragons', homeScore: 1, awayScore: 0, status: 'completed' },
      { homeTeam: 'Comets', awayTeam: 'Dragons', homeScore: 5, awayScore: 0, status: 'completed' }
    ];

    const table = computeNativeStandings(games, {
      rankingMode: 'points',
      points: { win: 3, tie: 1, loss: 0 },
      twoTeamTiebreakers: ['head_to_head', 'point_diff', 'name'],
      multiTeamTiebreakers: ['group_head_to_head', 'point_diff', 'name']
    });

    expect(table.slice(0, 2).map((row) => row.team)).toEqual(['Alpha', 'Comets']);
  });

  it('restarts with the two-team stack after a multi-team split leaves two teams tied', () => {
    const games = [
      { homeTeam: 'Bravo', awayTeam: 'Comets', homeScore: 3, awayScore: 0, status: 'completed' },
      { homeTeam: 'Dragons', awayTeam: 'Bravo', homeScore: 3, awayScore: 1, status: 'completed' },
      { homeTeam: 'Bravo', awayTeam: 'Eagles', homeScore: 1, awayScore: 2, status: 'completed' },
      { homeTeam: 'Eagles', awayTeam: 'Bravo', homeScore: 1, awayScore: 3, status: 'completed' },
      { homeTeam: 'Comets', awayTeam: 'Dragons', homeScore: 1, awayScore: 3, status: 'completed' },
      { homeTeam: 'Dragons', awayTeam: 'Eagles', homeScore: 0, awayScore: 2, status: 'completed' }
    ];

    const table = computeNativeStandings(games, {
      rankingMode: 'points',
      points: { win: 3, tie: 1, loss: 0 },
      twoTeamTiebreakers: ['head_to_head', 'point_diff', 'name'],
      multiTeamTiebreakers: ['group_head_to_head', 'point_diff', 'name']
    });

    expect(table.map((row) => row.team)).toEqual(['Eagles', 'Dragons', 'Bravo', 'Comets']);
    expect(table.find((row) => row.team === 'Dragons').pd).toBe(table.find((row) => row.team === 'Bravo').pd);
  });
});
