import {
  DIAMOND_PLAYER_STAT_CATALOG as legacyDiamondPlayerStatCatalog,
  DIAMOND_TEAM_STAT_CATALOG as legacyDiamondTeamStatCatalog,
  DIAMOND_TRACKING_ENGINE as legacyDiamondTrackingEngine,
  aggregateCoverageAwareSeasonStats as legacyAggregateCoverageAwareSeasonStats,
  getCoverageAwareStatValue as legacyGetCoverageAwareStatValue,
  getDiamondCatalogDefinition as legacyGetDiamondCatalogDefinition,
  getPublicDiamondStatCatalog as legacyGetPublicDiamondStatCatalog,
  isDiamondV2Game as legacyIsDiamondV2Game,
  readCoverageAwareOpponentStats as legacyReadCoverageAwareOpponentStats,
  readCoverageAwareStatDocument as legacyReadCoverageAwareStatDocument,
  resolveDiamondProjectionState as legacyResolveDiamondProjectionState
} from '@legacy/diamond-stat-presentation.js';

export type DiamondCoverageStatus = 'complete' | 'partial' | 'not_collected';

export type CoverageAwareStatPresentation = {
  isDiamond: boolean;
  statCoverage: Record<string, DiamondCoverageStatus>;
  observedStatKeys: readonly string[];
  unavailableStatKeys: readonly string[];
  projectionPending?: boolean;
  sourceRevision?: number | null;
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
export const readCoverageAwareStatDocument = legacyReadCoverageAwareStatDocument as (document: unknown, game?: unknown) => CoverageAwareStatView;
export const readCoverageAwareOpponentStats = legacyReadCoverageAwareOpponentStats as (document: unknown, game?: unknown) => CoverageAwareStatView;
export const resolveDiamondProjectionState = legacyResolveDiamondProjectionState as (...args: any[]) => CoverageAwareStatView['projection'];
export const aggregateCoverageAwareSeasonStats = legacyAggregateCoverageAwareSeasonStats as (...args: any[]) => {
  statsByPlayerId: Record<string, Record<string, string | number | boolean | null>>;
  completeStatsByPlayerId: Record<string, Record<string, string | number | boolean | null>>;
  presentationByPlayerId: Record<string, CoverageAwareStatPresentation>;
  projection: { hasDiamond: boolean; pending: boolean; sourceRevisions: readonly number[] };
};
export const getCoverageAwareStatValue = legacyGetCoverageAwareStatValue as (...args: any[]) => {
  available: boolean;
  observed: boolean;
  status: DiamondCoverageStatus | 'legacy_missing';
  text: string;
  value: unknown;
};
export const getDiamondCatalogDefinition = legacyGetDiamondCatalogDefinition as (statId: string, scope?: 'player' | 'team') => Record<string, any> | null;
export const getPublicDiamondStatCatalog = legacyGetPublicDiamondStatCatalog as (resolvedConfig?: unknown, scope?: 'player' | 'team') => ReadonlyArray<Record<string, any>>;
