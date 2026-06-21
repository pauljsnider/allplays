import {
  getConfigs as legacyGetConfigs,
  getGame as legacyGetGame,
  getGameEvents as legacyGetGameEvents,
  getPlayers as legacyGetPlayers,
  getTeam as legacyGetTeam,
  getTeamStatsForGame as legacyGetTeamStatsForGame
} from '@legacy/db.js';
import { collection as legacyCollection, db as legacyDb, getDocs as legacyGetDocs } from '@legacy/firebase.js';
import { resolveReportStatColumns as legacyResolveReportStatColumns, resolveOpponentReportStatColumns as legacyResolveOpponentReportStatColumns } from '@legacy/game-report-stats.js';
import { buildHighlightShareUrl as legacyBuildHighlightShareUrl, normalizeGameRecapHighlightClips as legacyNormalizeGameRecapHighlightClips } from '@legacy/live-game-video.js';
import { resolveLiveStatConfig as legacyResolveLiveStatConfig } from '@legacy/live-game-state.js';
import { generateGameInsights as legacyGenerateGameInsights } from '@legacy/post-game-insights.js';
import { hasPlayerProfileParticipation as legacyHasPlayerProfileParticipation } from '@legacy/player-profile-stats.js';
import { resolvePostGameTeamStatFields as legacyResolvePostGameTeamStatFields } from '@legacy/post-game-stat-editor.js';

/**
 * Typed adapter boundary for the legacy js/ game-report helpers (#2066). Bindings
 * re-exported as-is so existing js/* test mocks apply via the @legacy alias;
 * legacy shapes stay loose.
 */
export const getConfigs = legacyGetConfigs as (...args: any[]) => Promise<any>;
export const getGame = legacyGetGame as (...args: any[]) => Promise<any>;
export const getGameEvents = legacyGetGameEvents as (...args: any[]) => Promise<any>;
export const getPlayers = legacyGetPlayers as (...args: any[]) => Promise<any>;
export const getTeam = legacyGetTeam as (...args: any[]) => Promise<any>;
export const getTeamStatsForGame = legacyGetTeamStatsForGame as (...args: any[]) => Promise<any>;
export const collection = legacyCollection as (...args: any[]) => any;
export const getDocs = legacyGetDocs as (...args: any[]) => Promise<any>;
export const db: unknown = legacyDb;
export const resolveReportStatColumns = legacyResolveReportStatColumns as (...args: any[]) => any;
export const resolveOpponentReportStatColumns = legacyResolveOpponentReportStatColumns as (...args: any[]) => any;
export const buildHighlightShareUrl = legacyBuildHighlightShareUrl as (...args: any[]) => any;
export const normalizeGameRecapHighlightClips = legacyNormalizeGameRecapHighlightClips as (...args: any[]) => any;
export const resolveLiveStatConfig = legacyResolveLiveStatConfig as (...args: any[]) => any;
export const generateGameInsights = legacyGenerateGameInsights as (...args: any[]) => any;
export const hasPlayerProfileParticipation = legacyHasPlayerProfileParticipation as (...args: any[]) => boolean;
export const resolvePostGameTeamStatFields = legacyResolvePostGameTeamStatFields as (...args: any[]) => any;
