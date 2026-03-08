# Architecture role

- Current state: `buildAthleteProfileSeasonSummary(link)` concurrently fetches team, player, and games, but the team fetch uses the active-only `getTeam()` default.
- Proposed state: keep the aggregation pipeline unchanged except for `getTeam(link.teamId, { includeInactive: true })` inside the athlete-profile season-summary helper.
- Blast radius: one helper in `js/db.js` plus a focused unit guard; all other team lookups keep current active-team filtering.
- Controls: this does not widen reads beyond data already reachable through parent-linked season keys, and it preserves the existing explicit opt-in pattern already used elsewhere for historical/inactive data.
