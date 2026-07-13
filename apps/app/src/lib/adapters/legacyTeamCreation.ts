import { createConfig as legacyCreateConfig, createTeam as legacyCreateTeam } from '@legacy/db.js';
import {
  getDefaultStatConfigForSport as legacyGetDefaultStatConfigForSport,
  getStatConfigPresetOptions as legacyGetStatConfigPresetOptions
} from '@legacy/stat-config-presets.js';

export const createTeam = legacyCreateTeam as (teamData: Record<string, unknown>) => Promise<string>;
export const createConfig = legacyCreateConfig as (teamId: string, configData: unknown) => Promise<string>;

export function getDefaultStatConfigForSport(sport: string): unknown {
  return legacyGetDefaultStatConfigForSport(sport);
}

export function getStatConfigPresetOptions(): unknown[] {
  return legacyGetStatConfigPresetOptions() as unknown[];
}
