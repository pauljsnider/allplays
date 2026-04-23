import { describe, expect, it } from 'vitest';
import {
  applyTournamentStandingsOverride,
  buildTournamentPoolOverrideKey,
  buildTournamentPoolStandings
} from '../../js/tournament-standings.js';

describe('tournament standings helpers', () => {
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
});
