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

export type PublicTeamProjectionIdentity = {
  id?: unknown;
  name?: unknown;
};

export type PublicTeamProjectedGame = {
  id?: unknown;
  teamId?: unknown;
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
  tournament?: unknown;
};

export type PublicTeamGamesProjection = {
  team: PublicTeamProjectionIdentity;
  games: PublicTeamProjectedGame[];
};

export async function getPublicTeamGamesProjection(teamId: string): Promise<PublicTeamGamesProjection> {
  const callable = legacyHttpsCallable(legacyFunctions, 'getPublicTeamGamesProjection');
  const games: PublicTeamProjectedGame[] = [];
  const seenCursors = new Set<string>();
  let projectionTeam: PublicTeamProjectionIdentity | null = null;
  let cursor = '';

  do {
    const result = await callable({
      teamId,
      limit: 500,
      ...(cursor ? { cursor } : {})
    });
    const data = result.data || {};
    const responseTeam = data.team && typeof data.team === 'object' && !Array.isArray(data.team)
      ? data.team as PublicTeamProjectionIdentity
      : {};
    if (String(responseTeam.id || '').trim() !== teamId) {
      throw new Error('Public team not found.');
    }
    if (projectionTeam && String(responseTeam.name || '').trim() !== String(projectionTeam.name || '').trim()) {
      throw new Error('Public team projection identity changed during pagination.');
    }
    projectionTeam ||= responseTeam;
    if (Array.isArray(data.games)) games.push(...data.games);
    if (data.range?.truncated !== true) break;

    const nextCursor = typeof data.nextCursor === 'string' ? data.nextCursor : '';
    if (!nextCursor || seenCursors.has(nextCursor)) {
      throw new Error('Public games projection pagination did not provide a usable cursor.');
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (cursor);

  return {
    team: projectionTeam || {},
    games
  };
}
