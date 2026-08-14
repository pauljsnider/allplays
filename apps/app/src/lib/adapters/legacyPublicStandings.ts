import { computeNativeStandings as legacyComputeNativeStandings } from '@legacy/native-standings.js';

export const computeNativeStandings = legacyComputeNativeStandings as (
  games: Array<Record<string, unknown>>,
  config?: Record<string, unknown>
) => Array<Record<string, unknown>>;
