import { addDrillFavorite as legacyAddDrillFavorite, getDrill as legacyGetDrill, getDrillFavorites as legacyGetDrillFavorites, getDrills as legacyGetDrills, getPublishedDrills as legacyGetPublishedDrills, getTeam as legacyGetTeam, removeDrillFavorite as legacyRemoveDrillFavorite } from '@legacy/db.js';
import { DRILL_LEVELS as legacyDrillLevels, DRILL_TYPES as legacyDrillTypes } from '@legacy/drill-constants.js';
import { hasFullTeamAccess as legacyHasFullTeamAccess } from '@legacy/team-access.js';

/**
 * Typed adapter boundary for the legacy js/ team-drills helpers (#2066).
 * Bindings re-exported as-is so existing js/* test mocks apply via the @legacy alias.
 */
export const addDrillFavorite = legacyAddDrillFavorite as (...args: any[]) => Promise<any>;
export const getDrill = legacyGetDrill as (...args: any[]) => Promise<any>;
export const getDrillFavorites = legacyGetDrillFavorites as (...args: any[]) => Promise<any>;
export const getDrills = legacyGetDrills as (...args: any[]) => Promise<any>;
export const getPublishedDrills = legacyGetPublishedDrills as (...args: any[]) => Promise<any>;
export const getTeam = legacyGetTeam as (...args: any[]) => Promise<any>;
export const removeDrillFavorite = legacyRemoveDrillFavorite as (...args: any[]) => Promise<any>;
export const DRILL_LEVELS = legacyDrillLevels as readonly string[];
export const DRILL_TYPES = legacyDrillTypes as readonly string[];
export const hasFullTeamAccess = legacyHasFullTeamAccess as (...args: any[]) => boolean;
