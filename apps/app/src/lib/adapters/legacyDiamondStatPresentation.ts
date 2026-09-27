import {
  DIAMOND_PLAYER_STAT_CATALOG as legacyDiamondPlayerStatCatalog,
  DIAMOND_TEAM_STAT_CATALOG as legacyDiamondTeamStatCatalog,
  DIAMOND_TRACKING_ENGINE as legacyDiamondTrackingEngine,
  aggregateCoverageAwareSeasonStats as legacyAggregateCoverageAwareSeasonStats,
  aggregateCoverageAwareTeamStats as legacyAggregateCoverageAwareTeamStats,
  getCoverageAwareStatValue as legacyGetCoverageAwareStatValue,
  getDiamondCatalogDefinition as legacyGetDiamondCatalogDefinition,
  getDiamondProjectionIdentity as legacyGetDiamondProjectionIdentity,
  getDiamondPublicPlayerStatsCollectionPath as legacyGetDiamondPublicPlayerStatsCollectionPath,
  getManagerDiamondStatCatalog as legacyGetManagerDiamondStatCatalog,
  getPublicDiamondStatCatalog as legacyGetPublicDiamondStatCatalog,
  isDiamondV2Game as legacyIsDiamondV2Game,
  readCoverageAwareOpponentStats as legacyReadCoverageAwareOpponentStats,
  readCoverageAwareStatDocument as legacyReadCoverageAwareStatDocument,
  resolveDiamondManagerStatDocuments as legacyResolveDiamondManagerStatDocuments,
  resolveDiamondPublicStatDocuments as legacyResolveDiamondPublicStatDocuments,
  resolveDiamondManagerTeamStatDocument as legacyResolveDiamondManagerTeamStatDocument,
  resolveDiamondPublicStatsResponse as legacyResolveDiamondPublicStatsResponse,
  resolveDiamondPublicTeamStatDocument as legacyResolveDiamondPublicTeamStatDocument,
  resolveDiamondProjectionState as legacyResolveDiamondProjectionState
} from '@legacy/diamond-stat-presentation.js';
import {
  buildDiamondStatsCsv as legacyBuildDiamondStatsCsv,
  getDiamondStatsExportFilename as legacyGetDiamondStatsExportFilename
} from '@legacy/diamond-stat-export.js';

export type DiamondCoverageStatus = 'complete' | 'partial' | 'not_collected';

export type CoverageAwareStatPresentation = {
  isDiamond: boolean;
  statCoverage: Record<string, DiamondCoverageStatus>;
  observedStatKeys: readonly string[];
  unavailableStatKeys: readonly string[];
  projectionPending?: boolean;
  sourceRevision?: number | null;
  statVisibility?: 'public' | 'manager-internal';
  projection?: {
    isDiamond: boolean;
    status: string;
    pending: boolean;
    authoritativeRevision: number | null;
    sourceRevisions: readonly number[];
  };
};

export type CoverageAwareStatView = CoverageAwareStatPresentation & {
  values: Record<string, string | number | boolean | null>;
  completeValues: Record<string, string | number | boolean | null>;
  familyCoverage?: Record<string, DiamondCoverageStatus>;
  sourceRevision: number | null;
  projection: NonNullable<CoverageAwareStatPresentation['projection']>;
};

export const DIAMOND_TRACKING_ENGINE = legacyDiamondTrackingEngine as 'diamond-v2';
export const DIAMOND_PLAYER_STAT_CATALOG = legacyDiamondPlayerStatCatalog as ReadonlyArray<Record<string, any>>;
export const DIAMOND_TEAM_STAT_CATALOG = legacyDiamondTeamStatCatalog as ReadonlyArray<Record<string, any>>;
export const isDiamondV2Game = legacyIsDiamondV2Game as (game: unknown) => boolean;
export const readCoverageAwareStatDocument = legacyReadCoverageAwareStatDocument as (
  document: unknown,
  game?: unknown
) => CoverageAwareStatView;
export const readCoverageAwareOpponentStats = legacyReadCoverageAwareOpponentStats as (
  document: unknown,
  game?: unknown
) => CoverageAwareStatView;
export const resolveDiamondProjectionState = legacyResolveDiamondProjectionState as (...args: any[]) => CoverageAwareStatView['projection'];
export const aggregateCoverageAwareSeasonStats = legacyAggregateCoverageAwareSeasonStats as (...args: any[]) => {
  statsByPlayerId: Record<string, Record<string, string | number | boolean | null>>;
  completeStatsByPlayerId: Record<string, Record<string, string | number | boolean | null>>;
  presentationByPlayerId: Record<string, CoverageAwareStatPresentation>;
  projection: { hasDiamond: boolean; pending: boolean; sourceRevisions: readonly number[] };
};
export const aggregateCoverageAwareTeamStats = legacyAggregateCoverageAwareTeamStats as (...args: any[]) => {
  stats: Record<string, string | number | boolean | null>;
  completeStats: Record<string, string | number | boolean | null>;
  presentation: CoverageAwareStatPresentation;
  projection: { hasDiamond: boolean; pending: boolean; sourceRevisions: readonly number[] };
};
export const getCoverageAwareStatValue = legacyGetCoverageAwareStatValue as (...args: any[]) => {
  available: boolean;
  observed: boolean;
  status: DiamondCoverageStatus | 'legacy_missing';
  text: string;
  value: unknown;
};
export const getDiamondCatalogDefinition = legacyGetDiamondCatalogDefinition as (
  statId: string,
  scope?: 'player' | 'team'
) => Record<string, any> | null;
export const getDiamondProjectionIdentity = legacyGetDiamondProjectionIdentity as (game: unknown) => null | {
  instanceId: string;
  sourceRevision: number;
  checkpointHash: string;
  statConfigSnapshotHash: string;
  projectionHash: string;
};
export const getDiamondPublicPlayerStatsCollectionPath = legacyGetDiamondPublicPlayerStatsCollectionPath as (input: {
  teamId: string;
  gameId: string;
  game: unknown;
}) => string | null;
export const getPublicDiamondStatCatalog = legacyGetPublicDiamondStatCatalog as (
  resolvedConfig?: unknown,
  scope?: 'player' | 'team'
) => ReadonlyArray<Record<string, any>>;
export const getManagerDiamondStatCatalog = legacyGetManagerDiamondStatCatalog as (
  resolvedConfig?: unknown,
  scope?: 'player' | 'team'
) => ReadonlyArray<Record<string, any>>;
export const resolveDiamondManagerStatDocuments = legacyResolveDiamondManagerStatDocuments as (input: {
  game: unknown;
  expectedPlayerIds?: string[];
  privateDocuments?: Array<{ id: string; data: Record<string, unknown> }>;
  loadStatus?: 'complete' | 'partial' | 'unavailable';
}) => {
  requestedVisibility: 'manager-internal';
  appliedVisibility: 'public' | 'manager-internal';
  status: 'complete' | 'partial' | 'unavailable';
  reason: string | null;
  documents: ReadonlyArray<{ id: string; data: Record<string, unknown> }>;
  identity: null | {
    instanceId: string;
    sourceRevision: number;
    checkpointHash: string;
    statConfigSnapshotHash: string;
    projectionHash: string;
  };
};
export const resolveDiamondPublicStatDocuments = legacyResolveDiamondPublicStatDocuments as (input: {
  teamId: string;
  gameId: string;
  game: unknown;
  documents?: Array<{ id: string; data: Record<string, unknown> }>;
  loadStatus?: 'complete' | 'partial' | 'unavailable';
}) => {
  requestedVisibility: 'public';
  appliedVisibility: 'public';
  status: 'complete' | 'partial' | 'unavailable';
  reason: string | null;
  documents: ReadonlyArray<{ id: string; data: Record<string, unknown> }>;
  absenceConfirmed: boolean;
  identity: ReturnType<typeof getDiamondProjectionIdentity>;
};
export const resolveDiamondManagerTeamStatDocument = legacyResolveDiamondManagerTeamStatDocument as (input: {
  game: unknown;
  privateDocument?: Record<string, unknown> | null;
  loadStatus?: 'complete' | 'partial' | 'unavailable';
}) => {
  requestedVisibility: 'manager-internal';
  appliedVisibility: 'public' | 'manager-internal';
  status: 'complete' | 'partial' | 'unavailable';
  reason: string | null;
  document: Record<string, unknown> | null;
  identity: null | {
    instanceId: string;
    sourceRevision: number;
    checkpointHash: string;
    statConfigSnapshotHash: string;
    projectionHash: string;
  };
};
export const resolveDiamondPublicTeamStatDocument = legacyResolveDiamondPublicTeamStatDocument as (input: {
  game: unknown;
  allowedStatIds?: string[] | null;
}) => {
  requestedVisibility: 'public';
  appliedVisibility: 'public';
  status: 'complete' | 'partial';
  reason: string | null;
  document: Record<string, unknown> | null;
  identity: null | {
    instanceId: string;
    sourceRevision: number;
    checkpointHash: string;
    statConfigSnapshotHash: string;
    projectionHash: string;
  };
};
export const resolveDiamondPublicStatsResponse = legacyResolveDiamondPublicStatsResponse as (value: unknown) => {
  status: 'complete' | 'partial' | 'unavailable';
  reason: string | null;
  complete: boolean;
  identity: ReturnType<typeof getDiamondProjectionIdentity>;
  publicTeamStats: Record<string, unknown> | null;
};
export const buildDiamondStatsCsv = legacyBuildDiamondStatsCsv as (input: {
  rows: Array<{
    recordType?: string;
    identity?: Record<string, unknown>;
    stats: Record<string, unknown>;
    presentation: CoverageAwareStatPresentation;
    sourceRevision?: number | null;
  }>;
  statDefinitions?: ReadonlyArray<Record<string, unknown>>;
  projection?: Record<string, unknown>;
  visibility?: 'public' | 'manager-internal';
}) => string;
export const getDiamondStatsExportFilename = legacyGetDiamondStatsExportFilename as (
  value: unknown,
  fallback?: string,
  visibility?: 'public' | 'manager-internal'
) => string;
