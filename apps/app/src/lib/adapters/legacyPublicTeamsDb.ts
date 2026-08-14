import {
  discoverPublicTeams as legacyDiscoverPublicTeams,
  getPublicTeamRosterCount as getLegacyPublicTeamRosterCount,
} from '@legacy/db.js';
import { functions as legacyFunctions, httpsCallable as legacyHttpsCallable } from '@legacy/firebase.js';

/**
 * Typed adapter boundary for the legacy js/ public-team discovery helper (#2066).
 */
export function discoverPublicTeams(options?: { searchText?: string; cursor?: unknown; pageSize?: number }): Promise<any> {
  return legacyDiscoverPublicTeams(options);
}

export type PublicTeamRosterCount = {
  count: number;
  isCapped: boolean;
};

export function getPublicTeamRosterCount(teamId: string): Promise<PublicTeamRosterCount> {
  return getLegacyPublicTeamRosterCount(teamId);
}

export async function getPublicTeamProfile(teamId: string): Promise<any> {
  const callable = legacyHttpsCallable(legacyFunctions, 'getPublicTeamProfile');
  const result = await callable({ teamId });
  return result.data?.item || null;
}

export type PublicTeamGamesProjectionOptions = {
  from: string;
  to: string;
  limit: number;
};

export type PublicTeamProjectedGame = {
  id?: unknown;
  startsAt?: unknown;
  opponent?: unknown;
  isHome?: unknown;
  status?: unknown;
  liveStatus?: unknown;
  type?: unknown;
  visibility?: unknown;
  isPrivate?: unknown;
  private?: unknown;
  deleted?: unknown;
  teamScore?: unknown;
  opponentScore?: unknown;
  countsTowardSeasonRecord?: unknown;
};

export type PublicTeamGamesProjection = {
  range?: { from?: unknown; to?: unknown; truncated?: unknown };
  games?: PublicTeamProjectedGame[];
};

export type PublicLeagueStandingsGame = {
  id?: unknown;
  startsAt?: unknown;
  homeTeam?: unknown;
  awayTeam?: unknown;
  homeTeamId?: unknown;
  awayTeamId?: unknown;
  homeScore?: unknown;
  awayScore?: unknown;
  status?: unknown;
  countsTowardSeasonRecord?: unknown;
};

export type PublicLeagueStandingsProjection = {
  range?: { from?: unknown; to?: unknown; truncated?: unknown };
  seasonLabel?: unknown;
  games?: PublicLeagueStandingsGame[];
};

export async function getPublicTeamGamesProjection(teamId: string, options: PublicTeamGamesProjectionOptions): Promise<PublicTeamGamesProjection | null> {
  const callable = legacyHttpsCallable(legacyFunctions, 'getPublicTeamGamesProjection');
  const result = await callable({ teamId, ...options });
  return result.data || null;
}

export async function getPublicLeagueStandingsProjection(teamId: string): Promise<PublicLeagueStandingsProjection | null> {
  const callable = legacyHttpsCallable(legacyFunctions, 'getPublicLeagueStandingsProjection');
  const result = await callable({ teamId });
  return result.data || null;
}
