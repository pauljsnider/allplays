/* Typed app boundary for the pure legacy tournament standings contract. */
import {
  buildTournamentPoolStandings as legacy_buildTournamentPoolStandings,
  getTournamentStandingsGroupName as legacy_getTournamentStandingsGroupName
} from '@legacy/tournament-standings.js';

export type LegacyTournamentStandingRow = Record<string, unknown> & {
  rank?: number | string;
  team?: string;
  teamName?: string;
};

export type LegacyTournamentPoolStanding = {
  poolName: string;
  gameCount: number;
  computedRows: LegacyTournamentStandingRow[];
  rows: LegacyTournamentStandingRow[];
  isOverridden: boolean;
  override: Record<string, unknown> | null;
};

export const buildTournamentPoolStandings = legacy_buildTournamentPoolStandings as (
  games: Array<Record<string, unknown>>,
  options?: {
    currentTeamName?: string | null;
    standingsConfig?: Record<string, unknown>;
    poolOverrides?: Record<string, unknown>;
  }
) => Record<string, LegacyTournamentPoolStanding>;

export const getTournamentStandingsGroupName = legacy_getTournamentStandingsGroupName as (
  game: Record<string, unknown>
) => string | null;
