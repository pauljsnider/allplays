import { discoverPublicTeams as legacyDiscoverPublicTeams } from '@legacy/db.js';

/**
 * Typed adapter boundary for the legacy js/ public-team discovery helper (#2066).
 */
export function discoverPublicTeams(options?: { searchText?: string; cursor?: unknown; pageSize?: number }): Promise<any> {
  return Promise.resolve(legacyDiscoverPublicTeams(options));
}
