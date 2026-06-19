import {
    DRILL_LEVELS as legacyDrillLevels,
    DRILL_TYPES as legacyDrillTypes,
    DRILL_TYPE_COLORS as legacyDrillTypeColors
} from '@legacy/drill-constants.js';

export type LegacyDrillTypeColor = {
    bg: string;
    text: string;
    bar: string;
};

export const DRILL_TYPES = legacyDrillTypes as readonly string[];
export const DRILL_LEVELS = legacyDrillLevels as readonly string[];
export const DRILL_TYPE_COLORS = legacyDrillTypeColors as Record<string, LegacyDrillTypeColor>;
