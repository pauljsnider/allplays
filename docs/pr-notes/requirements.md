# Requirements Role Notes (League Link + Standings)

## Objective
Enable coaches to save an external league URL and show league W/L/T standings on the team page.

## Current State
- `edit-team.html` has no `leagueUrl` field.
- Team page season record uses only local completed game scores from Firestore.
- `edit-schedule.html` calendar links are designed for ICS ingestion, not standings pages.

## Proposed State
- Add `leagueUrl` to team settings in `edit-team.html`.
- Persist `leagueUrl` in team document through existing `createTeam/updateTeam` flow.
- Fetch and parse TeamSideline standings table on `team.html` and display a league card with record metrics.

## Risk Surface / Blast Radius
- UI + read-only fetch changes limited to:
  - `edit-team.html`
  - `team.html`
  - `js/league-standings.js`
- No auth rules, write paths, or tenant-access controls changed.
- External dependency risk: third-party markup changes can degrade standings parsing.

## Assumptions
- TeamSideline standings pages keep `Team/W/L/T/PCT/PF/PA/PD` table structure.
- `leagueUrl` may be absent for many teams and should degrade gracefully.
- Matching team name to standings row is best-effort and may fall back to first row.

## Recommendation
Ship with defensive parsing + graceful fallback. This gives immediate W/L visibility with low schema/operational overhead and preserves current controls.
