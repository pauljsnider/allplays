import { getStatConfigPresetById as legacyGetStatConfigPresetById, getStatConfigPresetOptions as legacyGetStatConfigPresetOptions } from '@legacy/stat-config-presets.js';
import { normalizeStatTrackerConfig as legacyNormalizeStatTrackerConfig } from '@legacy/stat-leaderboards.js';

/**
 * Typed adapter boundary for the legacy js/ stat-tracker config helpers (#2066).
 * Returns `unknown` because the legacy shapes are untyped; callers narrow/cast.
 */
export function getStatConfigPresetById(presetId: string): unknown {
  return legacyGetStatConfigPresetById(presetId);
}

export function getStatConfigPresetOptions(): unknown[] {
  return legacyGetStatConfigPresetOptions() as unknown[];
}

export function normalizeStatTrackerConfig(config: unknown): unknown {
  return legacyNormalizeStatTrackerConfig(config);
}
