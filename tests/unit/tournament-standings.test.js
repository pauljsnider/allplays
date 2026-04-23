import { describe, expect, it } from 'vitest';
import { computeTournamentPoolStandings } from '../../js/tournament-standings.js';

describe('computeTournamentPoolStandings', () => {
  it('groups completed tournament games by pool and computes standings rows', () => {
    const pools = computeTournamentPoolStandings([
      {
        competitionType: 'tournament',
        status: 'completed',
        opponent: 'Lions',
        isHome: true,
        homeScore: 3,
        awayScore: 1,
        tournament: { poolName: 'Pool A' }
      },
      {
        competitionType: 'tournament',
        status: 'completed',
        opponent: 'Bears',
        isHome: false,
        homeScore: 5,
        awayScore: 2,
        tournament: { poolName: 'Pool A' }
      },
      {
        competitionType: 'tournament',
        status: 'completed',
        opponent: 'Falcons',
        isHome: true,
        homeScore: 4,
        awayScore: 0,
        tournament: { poolName: 'Pool B' }
      },
      {
        competitionType: 'league',
        status: 'completed',
        opponent: 'Ignored',
        isHome: true,
        homeScore: 1,
        awayScore: 0,
        tournament: { poolName: 'Pool A' }
      }
    ], {
      teamName: 'Tigers',
      standingsConfig: {
        rankingMode: 'points',
        points: { win: 3, tie: 1, loss: 0 }
      }
    });

    expect(pools.map((pool) => pool.poolName)).toEqual(['Pool A', 'Pool B']);
    expect(pools[0].rows.map((row) => row.teamName)).toEqual(['Tigers', 'Lions', 'Bears']);
    expect(pools[0].rows[0]).toMatchObject({
      teamName: 'Tigers',
      displayRank: '1',
      points: 6
    });
    expect(pools[1].rows[0]).toMatchObject({
      teamName: 'Tigers',
      displayRank: '1',
      points: 3
    });
  });

  it('swaps team-relative scores for away tournament games before computing standings', () => {
    const pools = computeTournamentPoolStandings([
      {
        competitionType: 'tournament',
        status: 'completed',
        opponent: 'Bears',
        isHome: false,
        homeScore: 4,
        awayScore: 1,
        tournament: { poolName: 'Pool A' }
      }
    ], {
      teamName: 'Tigers',
      standingsConfig: {
        rankingMode: 'points',
        points: { win: 3, tie: 1, loss: 0 }
      }
    });

    expect(pools[0].rows).toEqual([
      expect.objectContaining({ teamName: 'Tigers', points: 3, displayRank: '1' }),
      expect.objectContaining({ teamName: 'Bears', points: 0, displayRank: '2' })
    ]);
  });

  it('marks unresolved placements when configured tiebreakers cannot separate teams', () => {
    const pools = computeTournamentPoolStandings([
      {
        competitionType: 'tournament',
        status: 'completed',
        opponent: 'Lions',
        isHome: true,
        homeScore: 1,
        awayScore: 1,
        tournament: { poolName: 'Pool C' }
      }
    ], {
      teamName: 'Tigers',
      standingsConfig: {
        rankingMode: 'points',
        points: { win: 3, tie: 1, loss: 0 },
        tiebreakers: ['name']
      }
    });

    expect(pools[0].unresolvedTie).toBe(true);
    expect(pools[0].rows.map((row) => row.displayRank)).toEqual(['T-1', 'T-1']);
    expect(pools[0].rows.every((row) => row.unresolvedTie)).toBe(true);
  });
});
