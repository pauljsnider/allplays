# Current-State Read

`PublicTeamDetail` loads the public profile and recent results but renders only `team.standings`. The profile API does not normally publish computed rows. `getPublicTeamStandings(teamId)` already validates the public boundary, normalizes completed public-safe games, computes native standings, and returns display-safe rows plus the exact current row.

# Proposed Design

- Hydrate standings after the profile succeeds using `getPublicTeamStandings`.
- Keep standings loading, success, empty, and error state independent from profile and recent results.
- Pass hydrated standings to the existing table renderer without recomputation.
- Preserve the effect cancellation guard for route changes.

# Files And Modules Touched

- `apps/app/src/pages/PublicTeamDetail.tsx`
- `apps/app/src/pages/PublicTeamDetail.test.tsx`
- Per-run analysis artifacts under this directory.

# Data/State Impacts

Page-local transient state only. No persisted schema, cache, API response, or standings computation changes.

# Security/Permissions Impacts

No rules or permission changes. Hydration uses only the existing public service and does not load rosters, contacts, member data, or private schedules.

# Failure Modes And Mitigations

- Slow standings: show a local spinner without blocking the profile.
- Standings failure: show a local temporary-unavailable message.
- Disabled/no games: preserve the existing empty state.
- Route race: ignore stale async completion through the active guard.
- Duplicate public reads: accepted as bounded dependency behavior for this narrow slice.
