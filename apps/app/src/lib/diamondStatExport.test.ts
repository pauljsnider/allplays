import { beforeEach, describe, expect, it, vi } from 'vitest';

const publicActionMocks = vi.hoisted(() => ({ exportCsvFile: vi.fn() }));
vi.mock('./publicActions', () => publicActionMocks);

import {
  buildDiamondGameReportStatsCsv,
  buildDiamondTeamSeasonStatsCsv,
  exportDiamondGameReportStatsCsv,
  exportDiamondTeamSeasonStatsCsv
} from './diamondStatExport';

function reportFixture() {
  const projection = {
    isDiamond: true,
    status: 'pending',
    pending: true,
    authoritativeRevision: 13,
    sourceRevisions: [12]
  };
  return {
    team: { id: 'team-1', name: 'Falcons / 12U' },
    game: { id: 'game-1', date: new Date('2026-09-05T20:00:00.000Z'), opponent: 'Visitors', trackingEngine: 'diamond-v2' },
    diamond: projection,
    statKeys: ['h', 'avg', 'pitches'],
    statLabels: { h: 'H', avg: 'AVG', pitches: 'PITCHES' },
    statDefinitions: {
      h: { precision: 0 },
      avg: { precision: 3 },
      pitches: { precision: 0 }
    },
    playerRows: [
      {
        playerId: 'player-1',
        playerName: 'Avery Smith',
        number: '7',
        stats: { h: 0, avg: 0, pitches: 99 },
        didNotPlay: false,
        participationStatus: 'played',
        statPresentation: {
          isDiamond: true,
          sourceRevision: 12,
          statCoverage: { h: 'complete', avg: 'partial', pitches: 'not_collected' },
          observedStatKeys: ['avg'],
          unavailableStatKeys: ['pitches'],
          projection
        }
      }
    ],
    opponentRows: [],
    opponentStatKeys: [],
    opponentStatLabels: {},
    teamStats: { r: 2 },
    teamStatKeys: ['r'],
    teamStatLabels: { r: 'R' },
    teamStatDefinitions: { r: { precision: 0 } },
    teamStatPresentation: {
      isDiamond: true,
      sourceRevision: 12,
      statCoverage: { r: 'partial' },
      observedStatKeys: ['r'],
      unavailableStatKeys: [],
      projection
    }
  } as any;
}

describe('Diamond app report CSV export', () => {
  beforeEach(() => vi.clearAllMocks());

  it('includes team and player rows with coverage and exact revision evidence', () => {
    const result = buildDiamondGameReportStatsCsv(reportFixture());

    expect(result.filename).toBe('Falcons-12U-2026-09-05-diamond-stats-public.csv');
    expect(result.csv).toContain('"record_type"');
    expect(result.csv).toContain('"participation_status"');
    expect(result.csv).toContain('"h","h__coverage"');
    expect(result.csv).toContain('"pitches","pitches__coverage"');
    expect(result.csv).toContain('"pending","13","12"');
    expect(result.csv).toContain('"player","public","player-1","Avery Smith","7","played"');
    expect(result.csv).toContain('"0","complete","0","partial","","not_collected"');
    expect(result.csv.trim().split('\r\n')).toHaveLength(3);
  });

  it('hands the exact serialized artifact to native-aware public export', async () => {
    publicActionMocks.exportCsvFile.mockResolvedValue('shared');
    const report = reportFixture();
    const expected = buildDiamondGameReportStatsCsv(report);

    await expect(exportDiamondGameReportStatsCsv(report)).resolves.toBe('shared');
    expect(publicActionMocks.exportCsvFile).toHaveBeenCalledWith(expected.filename, expected.csv);
  });

  it('does not add an export path to legacy game reports', () => {
    const legacy = { ...reportFixture(), diamond: undefined };
    expect(() => buildDiamondGameReportStatsCsv(legacy)).toThrow(/only Diamond v2/i);
  });

  it('exports the sanitized public season team row without manager-only columns', async () => {
    const table = {
      seasonLabel: '2026',
      columns: [{ id: 'h', label: 'H' }],
      rows: [{
        playerId: 'player-1',
        playerName: 'Avery Smith',
        playerNumber: '7',
        values: { h: { value: 2, formattedValue: '2', available: true, observed: false, status: 'complete' } }
      }],
      teamStats: {
        columns: [{ id: 'r', label: 'R' }],
        values: { r: { value: 4, formattedValue: '4', available: true, observed: false, status: 'complete' } },
        presentation: {
          isDiamond: true,
          statCoverage: { r: 'complete' },
          observedStatKeys: [],
          unavailableStatKeys: [],
          statVisibility: 'public'
        }
      },
      diamond: {
        hasDiamond: true,
        pending: false,
        sourceRevisions: [8, 12],
        requestedStatVisibility: 'public',
        statVisibility: 'public',
        privateStatsStatus: 'not-requested'
      }
    } as any;

    const artifact = buildDiamondTeamSeasonStatsCsv('Falcons / 12U', table);
    expect(artifact.filename).toBe('Falcons-12U-2026-diamond-stats-public.csv');
    expect(artifact.visibility).toBe('public');
    expect(artifact.csv).toContain('"season_team","public","","Falcons / 12U"');
    expect(artifact.csv).toContain('"r","r__coverage"');
    expect(artifact.csv).not.toContain('pitches');

    publicActionMocks.exportCsvFile.mockResolvedValue('downloaded');
    await expect(exportDiamondTeamSeasonStatsCsv('Falcons / 12U', table)).resolves.toBe('downloaded');
    expect(publicActionMocks.exportCsvFile).toHaveBeenCalledWith(artifact.filename, artifact.csv);
  });

  it('keeps projected-only participant IDs out of season CSV while preserving canonical roster IDs', () => {
    const table = {
      seasonLabel: '2026',
      columns: [{ id: 'h', label: 'H' }],
      rows: [{
        playerId: 'player-1',
        playerName: 'Avery Smith',
        playerNumber: '7',
        values: { h: { value: 2, formattedValue: '2', available: true, status: 'complete' } }
      }, {
        playerId: 'manual:private-source-id',
        playerName: 'Recorded player',
        playerNumber: '-',
        canOpenProfile: false,
        values: { h: { value: 1, formattedValue: '1', available: true, status: 'complete' } }
      }],
      diamond: {
        hasDiamond: true,
        pending: false,
        sourceRevisions: [8],
        statVisibility: 'public'
      }
    } as any;

    const artifact = buildDiamondTeamSeasonStatsCsv('Falcons', table);

    expect(artifact.csv).toContain('"season_player","public","player-1","Avery Smith","7"');
    expect(artifact.csv).toContain('"season_player","public","","Recorded player","\'-"');
    expect(artifact.csv).not.toContain('manual:private-source-id');
  });
});
