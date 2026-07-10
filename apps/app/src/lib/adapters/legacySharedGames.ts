/* Typed app boundary for shared-game schedule projection. */
import { projectSharedGameForTeam as legacyProjectSharedGameForTeam } from '@legacy/shared-games.js';

export const projectSharedGameForTeam = legacyProjectSharedGameForTeam as (
  sharedGame: Record<string, unknown>,
  teamId: string
) => Record<string, unknown> | null;
