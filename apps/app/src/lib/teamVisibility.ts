// Mirror of the legacy `js/team-visibility.js` rule so web and mobile agree on
// what counts as an active team. A team is active unless it has been explicitly
// deactivated (`active: false`), archived, or given an inactive status.

export type TeamVisibilityRecord = {
  active?: boolean | null;
  archived?: boolean | null;
  status?: string | null;
} | null | undefined;

const INACTIVE_STATUSES = new Set(['archived', 'inactive', 'disabled']);

export function isTeamActive(team: TeamVisibilityRecord): boolean {
  const status = String(team?.status || '').trim().toLowerCase();
  return team?.active !== false
    && team?.archived !== true
    && !INACTIVE_STATUSES.has(status);
}
