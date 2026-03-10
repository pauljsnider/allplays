import { describe, expect, it } from 'vitest';
import { buildConfiguredStatFields, resolveReportStatColumns, resolveOpponentReportStatColumns } from '../../js/game-report-stats.js';

describe('game report stat helpers', () => {
  it('keeps soccer config labels even when no aggregated stats docs exist', () => {
    const result = resolveReportStatColumns({
      statsMap: {},
      resolvedConfig: {
        columns: ['GOALS', 'SHOTS', 'PASSES', 'BLOCKS', 'HUSTLE']
      }
    });

    expect(result.statKeys).toEqual(['goals', 'shots', 'passes', 'blocks', 'hustle']);
    expect(result.statLabels).toEqual({
      goals: 'GOALS',
      shots: 'SHOTS',
      passes: 'PASSES',
      blocks: 'BLOCKS',
      hustle: 'HUSTLE'
    });
  });

  it('maps legacy opponent points data onto soccer goals label when config is soccer', () => {
    const result = resolveOpponentReportStatColumns({
      opponentStats: {
        opp1: { name: '2', pts: 1, reb: 0, ast: 0 }
      },
      resolvedConfig: {
        columns: ['GOALS', 'SHOTS', 'PASSES', 'BLOCKS', 'HUSTLE']
      }
    });

    expect(result.oppKeys).toEqual(['pts', 'shots', 'passes', 'blocks', 'hustle']);
    expect(result.oppLabels).toEqual({
      pts: 'GOALS',
      shots: 'SHOTS',
      passes: 'PASSES',
      blocks: 'BLOCKS',
      hustle: 'HUSTLE'
    });
  });

  it('preserves basketball report columns when basketball stats exist', () => {
    const result = resolveReportStatColumns({
      statsMap: {
        p1: { pts: 12, reb: 5, ast: 4 }
      },
      resolvedConfig: {
        columns: ['PTS', 'REB', 'AST']
      }
    });

    expect(result.statKeys).toEqual(['pts', 'reb', 'ast']);
    expect(result.statLabels).toEqual({
      pts: 'PTS',
      reb: 'REB',
      ast: 'AST'
    });
  });

  it('falls back to discovered stat keys when no config is available', () => {
    const result = resolveReportStatColumns({
      statsMap: {
        p1: { goals: 1, shots: 3 }
      },
      resolvedConfig: null
    });

    expect(result.statKeys).toEqual(['goals', 'shots']);
    expect(result.statLabels).toEqual({
      goals: 'GOALS',
      shots: 'SHOTS'
    });
  });

  it('maps goal label to legacy pts field when needed', () => {
    expect(buildConfiguredStatFields(['GOALS'], [{ pts: 1 }])).toEqual([
      { fieldName: 'pts', label: 'GOALS' }
    ]);
  });
});
