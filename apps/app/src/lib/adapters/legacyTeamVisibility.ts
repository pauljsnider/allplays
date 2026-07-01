import { isTeamActive as legacyIsTeamActive } from '@legacy/team-visibility.js';

export type TeamVisibilityRecord = {
  active?: boolean | null;
  archived?: boolean | null;
  status?: string | null;
} | null | undefined;

/**
 * Typed adapter boundary for the legacy js/team-visibility.js active-team rule.
 */
export function isTeamActive(team: TeamVisibilityRecord): boolean {
  return legacyIsTeamActive(team);
}
