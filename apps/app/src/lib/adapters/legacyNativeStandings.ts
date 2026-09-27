/* Typed app boundary for the pure legacy native standings contract. */
import { computeNativeStandings as legacyComputeNativeStandings } from '@legacy/native-standings.js';

export const computeNativeStandings = legacyComputeNativeStandings as (
  games: unknown[],
  config?: unknown
) => Array<Record<string, any>>;
