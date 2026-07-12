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
