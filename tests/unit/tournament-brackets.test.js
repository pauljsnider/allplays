import { describe, expect, it } from 'vitest';
import {
  buildPoolStandingsIndex,
  collectTournamentAdvancementPatches,
  collectTournamentPoolSeeds,
  describeTournamentSource,
  getTournamentWinner,
  planTournamentPoolAdvancement
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

  it('reuses existing resolved pool seeds when advancing one pool', () => {
    const games = [
      {
        id: 'semi-1',
        competitionType: 'tournament',
        status: 'completed',
        homeScore: 3,
        awayScore: 1,
        tournament: {
          poolName: 'Pool A',
          slotAssignments: {
            home: { sourceType: 'pool_seed', poolName: 'Pool A', seed: 1 },
            away: { sourceType: 'pool_seed', poolName: 'Pool B', seed: 2 }
          },
          resolved: {
            homeLabel: 'Pool A #1',
            awayLabel: 'Lions',
            homeTeamName: null,
            awayTeamName: 'Lions',
            matchupLabel: 'Pool A #1 vs Lions',
            ready: false
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
          },
          resolved: {
            homeLabel: 'Winner semi-1',
            awayLabel: 'Bears',
            homeTeamName: null,
            awayTeamName: 'Bears',
            matchupLabel: 'Winner semi-1 vs Bears',
            ready: false
          }
        }
      }
    ];

    expect(buildPoolStandingsIndex(games)).toEqual({
      'Pool B': [{ teamName: 'Bears' }, { teamName: 'Lions' }]
    });
    expect(collectTournamentPoolSeeds(games, 'Pool A')).toEqual([1]);

    const plan = planTournamentPoolAdvancement(games, {
      poolName: 'Pool A',
      ranking: ['Tigers']
    });

    expect(plan.skipped).toBe(false);
    expect(plan.patches).toEqual([
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

  it('advances division-scoped pools when division lives on the tournament game', () => {
    const games = [
      {
        id: 'gold-semi',
        competitionType: 'tournament',
        tournament: {
          divisionName: '10U Gold',
          bracketName: 'Gold',
          roundName: 'Semifinal',
          slotAssignments: {
            home: { sourceType: 'pool_seed', poolName: 'Pool A', seed: 1 },
            away: { sourceType: 'pool_seed', poolName: 'Pool A', seed: 2 }
          }
        }
      },
      {
        id: 'silver-semi',
        competitionType: 'tournament',
        tournament: {
          divisionName: '12U Silver',
          bracketName: 'Silver',
          roundName: 'Semifinal',
          slotAssignments: {
            home: { sourceType: 'pool_seed', poolName: 'Pool A', seed: 1 },
            away: { sourceType: 'team', teamName: 'Wolves' }
          },
          resolved: {
            homeLabel: '12U Silver • Pool A #1',
            awayLabel: 'Wolves',
            homeTeamName: null,
            awayTeamName: 'Wolves',
            matchupLabel: '12U Silver • Pool A #1 vs Wolves',
            ready: false
          }
        }
      }
    ];

    expect(collectTournamentPoolSeeds(games, '10U Gold • Pool A')).toEqual([1, 2]);
    expect(collectTournamentPoolSeeds(games, '12U Silver • Pool A')).toEqual([1]);

    const plan = planTournamentPoolAdvancement(games, {
      poolName: '10U Gold • Pool A',
      ranking: ['Tigers', 'Lions']
    });

    expect(plan.skipped).toBe(false);
    expect(plan.requiredSeeds).toEqual([1, 2]);
    expect(plan.missingSeeds).toEqual([]);
    expect(plan.patches).toEqual([
      {
        gameId: 'gold-semi',
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
      }
    ]);
    expect(plan.previewRows).toEqual([
      expect.objectContaining({
        gameId: 'gold-semi',
        slot: 'home',
        sourceLabel: '10U Gold • Pool A #1',
        nextTeamName: 'Tigers'
      }),
      expect.objectContaining({
        gameId: 'gold-semi',
        slot: 'away',
        sourceLabel: '10U Gold • Pool A #2',
        nextTeamName: 'Lions'
      })
    ]);
  });

  it('skips pool advancement when a required seed is missing', () => {
    const games = [
      {
        id: 'semi-1',
        competitionType: 'tournament',
        tournament: {
          slotAssignments: {
            home: { sourceType: 'pool_seed', poolName: 'Pool A', seed: 1 },
            away: { sourceType: 'pool_seed', poolName: 'Pool A', seed: 2 }
          },
          resolved: {
            homeLabel: 'Pool A #1',
            awayLabel: 'Pool A #2',
            homeTeamName: null,
            awayTeamName: null,
            matchupLabel: 'Pool A #1 vs Pool A #2',
            ready: false
          }
        }
      }
    ];

    const plan = planTournamentPoolAdvancement(games, {
      poolName: 'Pool A',
      ranking: ['Tigers']
    });

    expect(plan.skipped).toBe(true);
    expect(plan.missingSeeds).toEqual([2]);
    expect(plan.patches).toEqual([]);
    expect(plan.reason).toContain('#2');
  });

  it('skips pool advancement when finalized standings are missing', () => {
    const games = [
      {
        id: 'semi-1',
        competitionType: 'tournament',
        tournament: {
          slotAssignments: {
            home: { sourceType: 'pool_seed', poolName: 'Pool A', seed: 1 },
            away: { sourceType: 'team', teamName: 'Lions' }
          }
        }
      }
    ];

    const plan = planTournamentPoolAdvancement(games, {
      poolName: 'Pool A'
    });

    expect(plan.skipped).toBe(true);
    expect(plan.missingSeeds).toEqual([1]);
    expect(plan.patches).toEqual([]);
    expect(plan.reason).toContain('No finalized ranking');
  });

  it('skips pool advancement when no eligible bracket slots exist', () => {
    const games = [
      {
        id: 'semi-1',
        competitionType: 'tournament',
        tournament: {
          slotAssignments: {
            home: { sourceType: 'pool_seed', poolName: 'Pool B', seed: 1 },
            away: { sourceType: 'team', teamName: 'Lions' }
          }
        }
      }
    ];

    const plan = planTournamentPoolAdvancement(games, {
      poolName: 'Pool A',
      ranking: ['Tigers']
    });

    expect(plan.skipped).toBe(true);
    expect(plan.requiredSeeds).toEqual([]);
    expect(plan.patches).toEqual([]);
    expect(plan.reason).toContain('No eligible pool-seed bracket slots');
  });

  it('previews existing slot overwrites before saving advancement', () => {
    const games = [
      {
        id: 'semi-1',
        competitionType: 'tournament',
        tournament: {
          slotAssignments: {
            home: { sourceType: 'pool_seed', poolName: 'Pool A', seed: 1 },
            away: { sourceType: 'team', teamName: 'Lions' }
          },
          resolved: {
            homeLabel: 'Old Tigers',
            awayLabel: 'Lions',
            homeTeamName: 'Old Tigers',
            awayTeamName: 'Lions',
            matchupLabel: 'Old Tigers vs Lions',
            ready: true
          }
        }
      }
    ];

    const plan = planTournamentPoolAdvancement(games, {
      poolName: 'Pool A',
      ranking: ['Tigers']
    });

    expect(plan.skipped).toBe(false);
    expect(plan.requiresOverwriteConfirmation).toBe(true);
    expect(plan.previewRows).toEqual([
      expect.objectContaining({
        gameId: 'semi-1',
        slot: 'home',
        currentTeamName: 'Old Tigers',
        nextTeamName: 'Tigers',
        overwritesExistingTeam: true
      })
    ]);
  });

  it('keeps finalized pool-seed slots stable after advancement is saved', () => {
    const games = [
      {
        id: 'semi-1',
        competitionType: 'tournament',
        tournament: {
          slotAssignments: {
            home: { sourceType: 'pool_seed', poolName: 'Pool A', seed: 1 },
            away: { sourceType: 'team', teamName: 'Lions' }
          }
        }
      }
    ];

    const plan = planTournamentPoolAdvancement(games, {
      poolName: 'Pool A',
      ranking: ['Tigers']
    });
    const savedGames = games.map((game) => game.id === 'semi-1'
      ? {
          ...game,
          tournament: {
            ...game.tournament,
            ...plan.patches[0].tournament
          }
        }
      : game);

    expect(plan.patches).toHaveLength(1);
    expect(collectTournamentAdvancementPatches(savedGames)).toEqual([]);
  });
});
