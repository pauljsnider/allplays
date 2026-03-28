import { describe, expect, it } from 'vitest';
import {
  describeTournamentSource,
  getTournamentWinner,
  collectTournamentAdvancementPatches
} from '../../js/tournament-brackets.js';

describe('tournament bracket helpers', () => {
  it('describes pool seed sources with readable labels', () => {
    expect(describeTournamentSource({
      sourceType: 'pool_seed',
      poolName: 'Pool A',
      seed: 1
    })).toBe('Pool A #1');
  });

  it('returns the completed winner side only when a game is final', () => {
    expect(getTournamentWinner({
      status: 'completed',
      homeScore: 3,
      awayScore: 1
    })).toBe('home');

    expect(getTournamentWinner({
      status: 'completed',
      homeScore: 2,
      awayScore: 2
    })).toBe(null);

    expect(getTournamentWinner({
      status: 'live',
      homeScore: 3,
      awayScore: 1
    })).toBe(null);
  });

  it('resolves downstream slots from pool seeding and prior-game winners', () => {
    const games = [
      {
        id: 'semi-1',
        competitionType: 'tournament',
        status: 'completed',
        homeScore: 4,
        awayScore: 1,
        tournament: {
          bracketName: 'Gold',
          roundName: 'Semifinal',
          slotAssignments: {
            home: { sourceType: 'pool_seed', poolName: 'Pool A', seed: 1 },
            away: { sourceType: 'pool_seed', poolName: 'Pool B', seed: 2 }
          }
        }
      },
      {
        id: 'final-1',
        competitionType: 'tournament',
        status: 'scheduled',
        tournament: {
          bracketName: 'Gold',
          roundName: 'Final',
          slotAssignments: {
            home: { sourceType: 'game_result', gameId: 'semi-1', outcome: 'winner' },
            away: { sourceType: 'pool_seed', poolName: 'Pool B', seed: 1 }
          }
        }
      }
    ];

    const poolStandings = {
      'Pool A': [{ teamName: 'Tigers' }],
      'Pool B': [{ teamName: 'Bears' }, { teamName: 'Lions' }]
    };

    const patches = collectTournamentAdvancementPatches(games, { poolStandings });
    expect(patches).toEqual([
      {
        gameId: 'semi-1',
        tournament: {
          resolved: {
            homeLabel: 'Tigers',
            awayLabel: 'Lions',
            homeTeamName: 'Tigers',
            awayTeamName: 'Lions',
            matchupLabel: 'Tigers vs Lions',
            ready: true
          }
        }
      },
      {
        gameId: 'final-1',
        tournament: {
          resolved: {
            homeLabel: 'Tigers',
            awayLabel: 'Bears',
            homeTeamName: 'Tigers',
            awayTeamName: 'Bears',
            matchupLabel: 'Tigers vs Bears',
            ready: true
          }
        }
      }
    ]);
  });

  it('keeps placeholders when upstream winners are unresolved', () => {
    const patches = collectTournamentAdvancementPatches([
      {
        id: 'semi-1',
        competitionType: 'tournament',
        status: 'scheduled',
        tournament: {
          slotAssignments: {
            home: { sourceType: 'team', teamName: 'Tigers' },
            away: { sourceType: 'team', teamName: 'Lions' }
          }
        }
      },
      {
        id: 'final-1',
        competitionType: 'tournament',
        status: 'scheduled',
        tournament: {
          slotAssignments: {
            home: { sourceType: 'game_result', gameId: 'semi-1', outcome: 'winner' },
            away: { sourceType: 'team', teamName: 'Bears' }
          }
        }
      }
    ]);

    expect(patches[1]).toEqual({
      gameId: 'final-1',
      tournament: {
        resolved: {
          homeLabel: 'Winner semi-1',
          awayLabel: 'Bears',
          homeTeamName: null,
          awayTeamName: 'Bears',
          matchupLabel: 'Winner semi-1 vs Bears',
          ready: false
        }
      }
    });
  });
});
