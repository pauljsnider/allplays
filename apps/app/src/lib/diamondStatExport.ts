import type { GameReportData } from './gameReportService';
import type { TeamDetailRosterStatisticsTable } from './teamDetailService';
import {
  buildDiamondStatsCsv,
  getDiamondStatsExportFilename,
  type CoverageAwareStatPresentation,
  type DiamondCoverageStatus
} from './adapters/legacyDiamondStatPresentation';
import { exportCsvFile, type ExportCsvResult } from './publicActions';

function normalizeDate(value: unknown): string {
  if (!value) return '';
  let candidate: Date;
  if (value instanceof Date) candidate = value;
  else if (typeof (value as { toDate?: unknown })?.toDate === 'function') candidate = (value as { toDate: () => Date }).toDate();
  else if (typeof (value as { seconds?: unknown })?.seconds === 'number')
    candidate = new Date(Number((value as { seconds: number }).seconds) * 1000);
  else candidate = new Date(String(value));
  return Number.isNaN(candidate.getTime()) ? '' : candidate.toISOString().slice(0, 10);
}

function definitionList(
  keys: string[],
  labels: Record<string, string>,
  definitions: Record<string, Record<string, unknown>> = {},
  visibility: 'public' | 'manager-internal' = 'public'
) {
  return (Array.isArray(keys) ? keys : []).map((key) => ({
    ...(definitions[key] || {}),
    id: key,
    label: labels[key] || key,
    visibility
  }));
}

function diamondPresentation(
  value: CoverageAwareStatPresentation | undefined,
  projection: NonNullable<GameReportData['diamond']>
): CoverageAwareStatPresentation {
  return {
    isDiamond: true,
    statCoverage: value?.statCoverage || {},
    observedStatKeys: value?.observedStatKeys || [],
    unavailableStatKeys: value?.unavailableStatKeys || [],
    projectionPending: value?.projectionPending ?? projection.pending,
    sourceRevision: value?.sourceRevision,
    projection: value?.projection || {
      isDiamond: true,
      status: projection.status,
      pending: projection.pending,
      authoritativeRevision: projection.authoritativeRevision,
      sourceRevisions: projection.sourceRevisions
    }
  };
}

export function buildDiamondGameReportStatsCsv(report: GameReportData) {
  if (!report.diamond?.isDiamond) throw new Error('Only Diamond v2 game reports support coverage-aware CSV export.');

  const projection = report.diamond;
  const visibility = projection.statVisibility === 'manager-internal' ? 'manager-internal' : 'public';
  const commonIdentity = {
    gameId: String(report.game?.id || ''),
    gameDate: normalizeDate(report.game?.date),
    opponent: String(report.game?.opponent || '')
  };
  const rows = [
    ...(report.teamStatPresentation?.isDiamond
      ? [
          {
            recordType: 'team',
            identity: { ...commonIdentity, playerName: String(report.team?.name || 'Team') },
            stats: report.teamStats || {},
            presentation: diamondPresentation(report.teamStatPresentation, projection)
          }
        ]
      : []),
    ...(report.playerRows || []).flatMap((player) =>
      player.statPresentation?.isDiamond
        ? [
            {
              recordType: player.didNotPlay ? 'player_dnp' : 'player',
              identity: {
                ...commonIdentity,
                playerId: player.canOpenProfile === false ? '' : player.playerId,
                playerName: player.playerName,
                playerNumber: player.number,
                participationStatus: player.participationStatus
              },
              stats: player.stats || {},
              presentation: diamondPresentation(player.statPresentation, projection)
            }
          ]
        : []
    ),
    ...(visibility === 'public' ? report.opponentRows || [] : []).flatMap((player) =>
      player.statPresentation?.isDiamond
        ? [
            {
              recordType: 'opponent',
              identity: {
                ...commonIdentity,
                playerId: player.id,
                playerName: player.name,
                playerNumber: player.number
              },
              stats: player.stats || {},
              presentation: diamondPresentation(player.statPresentation, projection)
            }
          ]
        : []
    )
  ];
  const statDefinitions = [
    ...definitionList(report.statKeys, report.statLabels, report.statDefinitions, visibility),
    ...(visibility === 'public'
      ? definitionList(report.opponentStatKeys, report.opponentStatLabels, report.opponentStatDefinitions, 'public')
      : []),
    ...definitionList(report.teamStatKeys, report.teamStatLabels, report.teamStatDefinitions, visibility)
  ];
  rows.forEach((row) => {
    row.presentation = { ...row.presentation, statVisibility: visibility };
  });
  const csv = buildDiamondStatsCsv({ rows, statDefinitions, projection, visibility });
  const teamName = String(report.team?.name || 'team');
  const date = commonIdentity.gameDate || 'game';
  return {
    csv,
    filename: getDiamondStatsExportFilename(`${teamName}-${date}-diamond-stats`, 'allplays-diamond-stats', visibility)
  };
}

export async function exportDiamondGameReportStatsCsv(report: GameReportData): Promise<ExportCsvResult> {
  const { filename, csv } = buildDiamondGameReportStatsCsv(report);
  return exportCsvFile(filename, csv);
}

function seasonPresentationFromValues(
  values: TeamDetailRosterStatisticsTable['rows'][number]['values'],
  table: TeamDetailRosterStatisticsTable,
  visibility: 'public' | 'manager-internal'
): CoverageAwareStatPresentation {
  const entries = Object.entries(values || {});
  const statCoverage = Object.fromEntries(entries.map(([id, value]) => {
    const status: DiamondCoverageStatus = value.status === 'complete' || value.status === 'partial'
      ? value.status
      : 'not_collected';
    return [id, status];
  }));
  return {
    isDiamond: true,
    statCoverage,
    observedStatKeys: entries.filter(([, value]) => value.observed === true).map(([id]) => id),
    unavailableStatKeys: entries.filter(([, value]) => value.available !== true).map(([id]) => id),
    projectionPending: table.diamond?.pending === true,
    statVisibility: visibility,
    projection: {
      isDiamond: true,
      status: table.diamond?.pending ? 'pending' : 'current',
      pending: table.diamond?.pending === true,
      authoritativeRevision: null,
      sourceRevisions: table.diamond?.sourceRevisions || []
    }
  };
}

function statsFromSeasonValues(values: TeamDetailRosterStatisticsTable['rows'][number]['values']) {
  return Object.fromEntries(Object.entries(values || {}).flatMap(([id, value]) => (
    value.available === true && value.value !== null ? [[id, value.value]] : []
  )));
}

export function buildDiamondTeamSeasonStatsCsv(
  teamName: string,
  table: TeamDetailRosterStatisticsTable
) {
  if (!table.diamond?.hasDiamond) throw new Error('Only Diamond v2 season reports support coverage-aware CSV export.');
  const visibility = table.diamond.statVisibility === 'manager-internal' ? 'manager-internal' : 'public';
  const projection = {
    status: table.diamond.pending ? 'pending' : 'current',
    pending: table.diamond.pending,
    authoritativeRevision: null,
    sourceRevisions: table.diamond.sourceRevisions
  };
  const rows = [
    ...(table.teamStats?.presentation?.isDiamond ? [{
      recordType: 'season_team',
      identity: { playerName: String(teamName || 'Team') },
      stats: statsFromSeasonValues(table.teamStats.values),
      presentation: { ...table.teamStats.presentation, statVisibility: visibility } as CoverageAwareStatPresentation
    }] : []),
    ...table.rows.map((row) => ({
      recordType: 'season_player',
      identity: {
        playerId: row.canOpenProfile === false ? '' : row.playerId,
        playerName: row.playerName,
        playerNumber: row.playerNumber
      },
      stats: statsFromSeasonValues(row.values),
      presentation: seasonPresentationFromValues(row.values, table, visibility)
    }))
  ];
  const statDefinitions = [
    ...table.columns.map((column) => ({ ...column, visibility })),
    ...(table.teamStats?.columns || []).map((column) => ({ ...column, visibility }))
  ];
  const csv = buildDiamondStatsCsv({ rows, statDefinitions, projection, visibility });
  return {
    csv,
    filename: getDiamondStatsExportFilename(
      `${String(teamName || 'team')}-${table.seasonLabel || 'season'}-diamond-stats`,
      'allplays-diamond-stats',
      visibility
    ),
    visibility
  };
}

export async function exportDiamondTeamSeasonStatsCsv(
  teamName: string,
  table: TeamDetailRosterStatisticsTable
): Promise<ExportCsvResult> {
  const { filename, csv } = buildDiamondTeamSeasonStatsCsv(teamName, table);
  return exportCsvFile(filename, csv);
}
