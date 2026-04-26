import { describe, expect, it } from 'vitest';
import {
  applyTournamentStandingsOverride,
  buildTournamentPoolOverrideKey,
  buildTournamentPoolStandings,
  computeTournamentPoolStandings
} from '../../js/tournament-standings.js';

describe('tournament standings helpers', () => {
  it('builds unique override keys for distinct pool names that share the same slug', () => {
    expect(buildTournamentPoolOverrideKey('Pool A')).not.toBe(buildTournamentPoolOverrideKey('Pool-A'));
    expect(buildTournamentPoolOverrideKey('Pool A')).not.toBe(buildTournamentPoolOverrideKey('Pool/A'));
  });

  it('builds computed pool standings from completed tournament games', () => {
    const standings = buildTournamentPoolStandings([
      {
        competitionType: 'tournament',
        status: 'completed',
        homeScore: 3,
        awayScore: 1,
        tournament: {
          poolName: 'Pool A',
          slotAssignments: {
            home: { sourceType: 'team', teamName: 'Tigers' },
            away: { sourceType: 'team', teamName: 'Lions' }
          }
        }
      },
      {
        competitionType: 'tournament',
        status: 'completed',
        homeScore: 2,
        awayScore: 0,
        tournament: {
          poolName: 'Pool A',
          slotAssignments: {
            home: { sourceType: 'team', teamName: 'Bears' },
            away: { sourceType: 'team', teamName: 'Tigers' }
          }
        }
      },
      {
        competitionType: 'tournament',
        status: 'completed',
        homeScore: 4,
        awayScore: 1,
        tournament: {
          poolName: 'Pool A',
          slotAssignments: {
            home: { sourceType: 'team', teamName: 'Lions' },
            away: { sourceType: 'team', teamName: 'Bears' }
          }
        }
      }
    ]);

    expect(standings['Pool A'].computedRows.map((row) => row.teamName)).toEqual(['Lions', 'Tigers', 'Bears']);
    expect(standings['Pool A'].rows.map((row) => row.rank)).toEqual([1, 2, 3]);
    expect(standings['Pool A'].gameCount).toBe(3);
    expect(standings['Pool A'].isOverridden).toBe(false);
  });

  it('applies a saved final ranking override with audit metadata', () => {
    const override = {
      poolName: 'Pool A',
      teamOrder: ['Lions', 'Bears', 'Tigers'],
      finalizedBy: { name: 'Coach Kim', email: 'kim@example.com' },
      finalizedAt: '2026-04-23T22:00:00.000Z'
    };

    const standings = buildTournamentPoolStandings([
      {
        competitionType: 'tournament',
        status: 'completed',
        homeScore: 3,
        awayScore: 1,
        tournament: {
          poolName: 'Pool A',
          slotAssignments: {
            home: { sourceType: 'team', teamName: 'Tigers' },
            away: { sourceType: 'team', teamName: 'Lions' }
          }
        }
      },
      {
        competitionType: 'tournament',
        status: 'completed',
        homeScore: 2,
        awayScore: 0,
        tournament: {
          poolName: 'Pool A',
          slotAssignments: {
            home: { sourceType: 'team', teamName: 'Bears' },
            away: { sourceType: 'team', teamName: 'Tigers' }
          }
        }
      },
      {
        competitionType: 'tournament',
        status: 'completed',
        homeScore: 4,
        awayScore: 1,
        tournament: {
          poolName: 'Pool A',
          slotAssignments: {
            home: { sourceType: 'team', teamName: 'Lions' },
            away: { sourceType: 'team', teamName: 'Bears' }
          }
        }
      }
    ], {
      poolOverrides: {
        [buildTournamentPoolOverrideKey('Pool A')]: override
      }
    });

    expect(standings['Pool A'].computedRows.map((row) => row.teamName)).toEqual(['Lions', 'Tigers', 'Bears']);
    expect(standings['Pool A'].rows.map((row) => row.teamName)).toEqual(['Lions', 'Bears', 'Tigers']);
    expect(standings['Pool A'].rows.map((row) => row.rank)).toEqual([1, 2, 3]);
    expect(standings['Pool A'].isOverridden).toBe(true);
    expect(standings['Pool A'].override).toEqual(override);
  });

  it('keeps overrides isolated for pools whose names normalize to the same legacy slug', () => {
    const poolAOverride = {
      poolName: 'Pool A',
      teamOrder: ['Lions', 'Tigers']
    };
    const poolDashOverride = {
      poolName: 'Pool-A',
      teamOrder: ['Bears', 'Hawks']
    };

    const standings = buildTournamentPoolStandings([
      {
        competitionType: 'tournament',
        status: 'completed',
        homeScore: 2,
        awayScore: 1,
        tournament: {
          poolName: 'Pool A',
          slotAssignments: {
            home: { sourceType: 'team', teamName: 'Tigers' },
            away: { sourceType: 'team', teamName: 'Lions' }
          }
        }
      },
      {
        competitionType: 'tournament',
        status: 'completed',
        homeScore: 3,
        awayScore: 0,
        tournament: {
          poolName: 'Pool-A',
          slotAssignments: {
            home: { sourceType: 'team', teamName: 'Hawks' },
            away: { sourceType: 'team', teamName: 'Bears' }
          }
        }
      }
    ], {
      poolOverrides: {
        [buildTournamentPoolOverrideKey('Pool A')]: poolAOverride,
        [buildTournamentPoolOverrideKey('Pool-A')]: poolDashOverride
      }
    });

    expect(standings['Pool A'].rows.map((row) => row.teamName)).toEqual(['Lions', 'Tigers']);
    expect(standings['Pool-A'].rows.map((row) => row.teamName)).toEqual(['Bears', 'Hawks']);
  });

  it('falls back to exact pool-name matches when reading legacy override entries', () => {
    const legacyOverride = {
      poolName: 'Pool A',
      teamOrder: ['Lions', 'Tigers']
    };

    const standings = buildTournamentPoolStandings([
      {
        competitionType: 'tournament',
        status: 'completed',
        homeScore: 2,
        awayScore: 1,
        tournament: {
          poolName: 'Pool A',
          slotAssignments: {
            home: { sourceType: 'team', teamName: 'Tigers' },
            away: { sourceType: 'team', teamName: 'Lions' }
          }
        }
      }
    ], {
      poolOverrides: {
        legacyCollisionKey: legacyOverride
      }
    });

    expect(standings['Pool A'].rows.map((row) => row.teamName)).toEqual(['Lions', 'Tigers']);
    expect(standings['Pool A'].override).toEqual(legacyOverride);
  });

  it('falls back to computed ranks when an override is cleared', () => {
    const applied = applyTournamentStandingsOverride([
      { team: 'Bears', rank: 2 },
      { team: 'Lions', rank: 1 }
    ], null);

    expect(applied.isOverridden).toBe(false);
    expect(applied.rows).toEqual([
      { team: 'Bears', rank: 1 },
      { team: 'Lions', rank: 2 }
    ]);
  });

  it('groups completed tournament games by pool for team pages', () => {
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

  it('computes division-scoped standings when tournament games use division names', () => {
    const pools = computeTournamentPoolStandings([
      {
        competitionType: 'tournament',
        status: 'completed',
        opponent: 'Lions',
        isHome: true,
        homeScore: 7,
        awayScore: 3,
        tournament: { divisionName: '10U Gold' }
      },
      {
        competitionType: 'tournament',
        status: 'completed',
        opponent: 'Bears',
        isHome: true,
        homeScore: 2,
        awayScore: 2,
        tournament: { divisionName: '10U Gold' }
      },
      {
        competitionType: 'tournament',
        status: 'completed',
        opponent: 'Hawks',
        isHome: false,
        homeScore: 5,
        awayScore: 1,
        tournament: { divisionName: '12U Silver' }
      }
    ], {
      teamName: 'Tigers',
      standingsConfig: {
        rankingMode: 'points',
        points: { win: 3, tie: 1, loss: 0 }
      }
    });

    expect(pools.map((pool) => pool.poolName)).toEqual(['10U Gold', '12U Silver']);
    expect(pools[0].rows.map((row) => row.teamName)).toEqual(['Tigers', 'Bears', 'Lions']);
    expect(pools[0].rows[0]).toMatchObject({
      teamName: 'Tigers',
      w: 1,
      l: 0,
      t: 1,
      points: 4,
      pf: 9,
      pa: 5,
      displayRank: '1'
    });
    expect(pools[1].rows[0]).toMatchObject({
      teamName: 'Tigers',
      points: 3,
      displayRank: '1'
    });
  });

  it('keeps empty and unscored tournament groups visible with empty rows', () => {
    const pools = computeTournamentPoolStandings([
      {
        competitionType: 'tournament',
        status: 'scheduled',
        opponent: 'Lions',
        isHome: true,
        tournament: { poolName: 'Pool A' }
      },
      {
        competitionType: 'tournament',
        status: 'completed',
        opponent: 'Bears',
        isHome: true,
        homeScore: '',
        awayScore: '',
        tournament: { poolName: 'Pool A' }
      },
      {
        competitionType: 'tournament',
        status: 'completed',
        opponent: 'Hawks',
        isHome: true,
        homeScore: null,
        awayScore: 1,
        tournament: { divisionName: '10U Gold' }
      }
    ], {
      teamName: 'Tigers',
      divisionNames: ['8U Bronze']
    });

    expect(pools.map((pool) => pool.poolName)).toEqual(['10U Gold', '8U Bronze', 'Pool A']);
    expect(pools.find((pool) => pool.poolName === 'Pool A')).toMatchObject({
      gameCount: 0,
      scheduledGameCount: 2,
      noScoreGameCount: 2,
      rows: []
    });
    expect(pools.find((pool) => pool.poolName === '10U Gold')).toMatchObject({
      gameCount: 0,
      scheduledGameCount: 1,
      noScoreGameCount: 1,
      rows: []
    });
    expect(pools.find((pool) => pool.poolName === '8U Bronze')).toMatchObject({
      gameCount: 0,
      scheduledGameCount: 0,
      noScoreGameCount: 0,
      rows: []
    });
  });

  it('swaps team-relative scores for away tournament games before computing team-page standings', () => {
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
