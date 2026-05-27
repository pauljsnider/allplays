import { describe, expect, it } from 'vitest';

import {
  aggregateSeasonStatsByPlayerId,
  buildPlayerLeaderboardSnapshot,
  evaluateDerivedFormula,
  normalizeStatTrackerConfig,
  parseAdvancedStatDefinitions,
  summarizePlayerTopStats,
  validateStatDefinitionsForPublicLeaderboards,
  splitPlayerStatsByVisibility
} from '../../js/stat-leaderboards.js';

describe('stat leaderboard helpers', () => {
  it('aggregates team leaderboard stats only for the selected season', async () => {
    const games = [
      { id: 'spring-1', status: 'completed', seasonLabel: 'Spring 2026', date: '2026-03-01' },
      { id: 'fall-1', status: 'completed', seasonLabel: 'Fall 2025', date: '2025-09-01' },
      { id: 'spring-pending', status: 'scheduled', seasonLabel: 'Spring 2026', date: '2026-03-08' }
    ];
    const statsByGame = {
      'spring-1': { p1: { pts: 12 }, p2: { pts: 8 } },
      'fall-1': { p1: { pts: 30 }, p2: { pts: 4 } },
      'spring-pending': { p1: { pts: 99 } }
    };

    const stats = await aggregateSeasonStatsByPlayerId({
      games,
      seasonLabel: 'Spring 2026',
      loadGameStats: async (game) => statsByGame[game.id]
    });

    expect(stats).toEqual({
      p1: { pts: 12 },
      p2: { pts: 8 }
    });

    const snapshot = buildPlayerLeaderboardSnapshot({
      config: {
        columns: ['PTS'],
        statDefinitions: [{ label: 'PTS', acronym: 'PTS', topStat: true }]
      },
      players: [
        { id: 'p1', name: 'Ava Cole' },
        { id: 'p2', name: 'Mia Brooks' }
      ],
      seasonStatsByPlayerId: stats
    });

    expect(snapshot.topStats[0].leader).toEqual(expect.objectContaining({
      playerId: 'p1',
      value: 12
    }));
  });

  it('normalizes legacy column-only configs into typed base stat definitions', () => {
    const normalized = normalizeStatTrackerConfig({
      name: 'Basketball Standard',
      baseType: 'Basketball',
      columns: ['PTS', 'REB', 'AST']
    });

    expect(normalized.columns).toEqual(['PTS', 'REB', 'AST']);
    expect(normalized.statDefinitions).toEqual([
      expect.objectContaining({
        id: 'pts',
        label: 'PTS',
        acronym: 'PTS',
        scope: 'player',
        visibility: 'public',
        type: 'base',
        formula: null,
        rankingOrder: 'desc',
        topStat: false
      }),
      expect.objectContaining({ id: 'reb', label: 'REB', type: 'base' }),
      expect.objectContaining({ id: 'ast', label: 'AST', type: 'base' })
    ]);
  });

  it('preserves underscores when normalizing stat ids', () => {
    const normalized = normalizeStatTrackerConfig({
      columns: ['SHOTS_ON_TARGET', 'TOTAL_SHOTS']
    });

    expect(normalized.statDefinitions).toEqual([
      expect.objectContaining({ id: 'shots_on_target', label: 'SHOTS_ON_TARGET' }),
      expect.objectContaining({ id: 'total_shots', label: 'TOTAL_SHOTS' })
    ]);
  });

  it('parses optional advanced derived stat definitions from textarea text', () => {
    const definitions = parseAdvancedStatDefinitions(`
FG%=fieldGoalPct|formula=(FGM/FGA)*100|group=Offense|format=percentage|precision=1|topStat=true
AST/TO=assistTurnoverRatio|formula=AST/TO|group=Offense|precision=2|rankingOrder=desc
Deflections=deflections|scope=team|visibility=private|group=Defense
    `);

    expect(definitions).toEqual([
      expect.objectContaining({
        id: 'fieldgoalpct',
        label: 'FG%',
        acronym: 'FG%',
        formula: '(FGM/FGA)*100',
        group: 'Offense',
        format: 'percentage',
        precision: 1,
        topStat: true,
        type: 'derived'
      }),
      expect.objectContaining({
        id: 'assistturnoverratio',
        label: 'AST/TO',
        rankingOrder: 'desc',
        precision: 2
      }),
      expect.objectContaining({
        id: 'deflections',
        scope: 'team',
        visibility: 'private',
        type: 'base'
      })
    ]);
  });

  it('prevents private or team-scoped stats from being public leaderboard top stats', () => {
    const definitions = parseAdvancedStatDefinitions(`
Hustle=hustle|visibility=private|scope=team|topStat=true
PTS=pts|visibility=public|scope=player|topStat=true
    `);

    expect(validateStatDefinitionsForPublicLeaderboards(definitions)).toEqual({
      valid: false,
      errors: ['Hustle cannot be a Top Stat unless visibility is public and scope is player.']
    });
  });

  it('splits private player stats away from public stat storage', () => {
    const config = normalizeStatTrackerConfig({
      columns: ['PTS', 'EFFORT'],
      statDefinitions: [
        { label: 'PTS', acronym: 'PTS' },
        { label: 'Coach Effort', acronym: 'EFFORT', id: 'effort', visibility: 'private', scope: 'player' },
        { label: 'Team Deflections', acronym: 'DEFL', id: 'deflections', visibility: 'private', scope: 'team' }
      ]
    });

    expect(splitPlayerStatsByVisibility(config, { pts: 12, effort: 4, deflections: 9 })).toEqual({
      publicStats: { pts: 12, deflections: 9 },
      privateStats: { effort: 4 }
    });
  });

  it('stores public stat keys by slugified definition id during visibility splitting', () => {
    const config = normalizeStatTrackerConfig({
      columns: ['AST/TO', 'FG%']
    });

    expect(splitPlayerStatsByVisibility(config, { 'AST/TO': 3, 'FG%': 47 })).toEqual({
      publicStats: { astto: 3, fg: 47 },
      privateStats: {}
    });
  });

  it('resolves punctuated base top stats from split public storage keys', () => {
    const config = normalizeStatTrackerConfig({
      columns: ['FG%'],
      statDefinitions: [
        { label: 'FG%', acronym: 'FG%', topStat: true, format: 'percentage', precision: 1 }
      ]
    });

    const { publicStats } = splitPlayerStatsByVisibility(config, { 'FG%': 47 });
    const snapshot = buildPlayerLeaderboardSnapshot({
      config,
      players: [{ id: 'p1', name: 'Ava Cole', number: '3' }],
      seasonStatsByPlayerId: { p1: publicStats }
    });

    expect(snapshot.topStats).toEqual([
      expect.objectContaining({
        id: 'fg',
        leader: expect.objectContaining({ playerId: 'p1', value: 47, formattedValue: '47.0%' })
      })
    ]);
  });

  it('builds grouped public leaderboards with derived metrics and ranking direction', () => {
    const config = normalizeStatTrackerConfig({
      name: 'Advanced Hoops',
      baseType: 'Basketball',
      columns: ['PTS', 'FGM', 'FGA', 'AST', 'TO'],
      statDefinitions: [
        { label: 'PTS', acronym: 'PTS' },
        { label: 'FGM', acronym: 'FGM' },
        { label: 'FGA', acronym: 'FGA' },
        { label: 'AST', acronym: 'AST' },
        { label: 'TO', acronym: 'TO', rankingOrder: 'asc' },
        { id: 'fieldGoalPct', label: 'FG%', acronym: 'FG%', formula: '(FGM/FGA)*100', group: 'Offense', format: 'percentage', precision: 1, topStat: true },
        { label: 'AST/TO', acronym: 'AST/TO', formula: 'AST / TO', group: 'Offense', precision: 2, topStat: true },
        { label: 'Coach Notes', acronym: 'NOTES', visibility: 'private', topStat: true },
        { label: 'Deflections', acronym: 'DEFL', scope: 'team', topStat: true }
      ]
    });

    const snapshot = buildPlayerLeaderboardSnapshot({
      config,
      players: [
        { id: 'p1', name: 'Ava Cole', number: '3' },
        { id: 'p2', name: 'Mia Brooks', number: '12' },
        { id: 'p3', name: 'Zoe Lane', number: '21' }
      ],
      seasonStatsByPlayerId: {
        p1: { pts: 40, fgm: 14, fga: 20, ast: 10, to: 5 },
        p2: { pts: 32, fgm: 12, fga: 18, ast: 9, to: 3 },
        p3: { pts: 20, fgm: 7, fga: 12, ast: 4, to: 1 }
      }
    });

    expect(snapshot.groups).toEqual([
      expect.objectContaining({
        id: 'offense',
        label: 'Offense',
        stats: expect.arrayContaining([
          expect.objectContaining({
            id: 'fieldgoalpct',
            label: 'FG%',
            leader: expect.objectContaining({ playerId: 'p1', value: 70, formattedValue: '70.0%' }),
            leaders: [
              expect.objectContaining({ playerId: 'p1', rank: 1 }),
              expect.objectContaining({ playerId: 'p2', rank: 2 }),
              expect.objectContaining({ playerId: 'p3', rank: 3 })
            ]
          }),
          expect.objectContaining({
            id: 'astto',
            leader: expect.objectContaining({ playerId: 'p3', value: 4, formattedValue: '4.00' })
          })
        ])
      })
    ]);

    expect(snapshot.topStats.map((stat) => stat.id)).toEqual(['fieldgoalpct', 'astto']);
  });

  it('summarizes the current player rank across configured top stats', () => {
    const config = normalizeStatTrackerConfig({
      name: 'Advanced Hoops',
      baseType: 'Basketball',
      columns: ['PTS', 'AST', 'TO'],
      statDefinitions: [
        { label: 'PTS', acronym: 'PTS', topStat: true },
        { label: 'AST/TO', acronym: 'AST/TO', formula: 'AST / TO', precision: 2, topStat: true }
      ]
    });

    const snapshot = buildPlayerLeaderboardSnapshot({
      config,
      players: [
        { id: 'p1', name: 'Ava Cole', number: '3' },
        { id: 'p2', name: 'Mia Brooks', number: '12' }
      ],
      seasonStatsByPlayerId: {
        p1: { pts: 24, ast: 8, to: 2 },
        p2: { pts: 30, ast: 9, to: 6 }
      }
    });

    expect(summarizePlayerTopStats(snapshot, 'p1')).toEqual([
      expect.objectContaining({
        id: 'pts',
        rank: 2,
        totalPlayers: 2,
        formattedValue: '24'
      }),
      expect.objectContaining({
        id: 'astto',
        rank: 1,
        formattedValue: '4.00'
      })
    ]);
  });

  it('evaluates derived formulas against underscored stat keys without dynamic code execution', () => {
    expect(evaluateDerivedFormula('(shots_on_target / shots) * 100', {
      shots_on_target: 7,
      shots: 10
    })).toBe(70);

    expect(evaluateDerivedFormula('"; while(true){}; //', {
      shots_on_target: 7,
      shots: 10
    })).toBeNull();
  });
});
