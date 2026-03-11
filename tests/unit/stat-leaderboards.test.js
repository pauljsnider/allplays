import { describe, expect, it } from 'vitest';

import {
  buildPlayerLeaderboardSnapshot,
  normalizeStatTrackerConfig,
  parseAdvancedStatDefinitions,
  summarizePlayerTopStats
} from '../../js/stat-leaderboards.js';

describe('stat leaderboard helpers', () => {
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
});
