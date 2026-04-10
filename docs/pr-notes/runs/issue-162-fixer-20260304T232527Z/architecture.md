# Architecture role (fallback synthesis)

## Root cause
- Document identity for parent RSVP in `submitRsvp` is `rsvps/{uid}`.
- Multiple child submissions for same event overwrite one doc's `playerIds/response`.
- Parent dashboard read path uses single `getMyRsvp(teamId, gameId, uid)` and broadcasts response across all child rows.

## Minimal safe design
1. In `parent-dashboard.html`, route child-scoped submissions to `submitRsvpForPlayer(...)` when exactly one child/player ID is resolved.
2. In `parent-dashboard.html`, replace single-user RSVP hydration with per-child resolution from `getRsvps(...)` filtered by `userId` and matching `playerIds`.
3. Add pure helper(s) in `js/parent-dashboard-rsvp.js` so hydration behavior is unit-testable and deterministic.

## Blast radius
- Touched surface: parent dashboard RSVP write/read behavior and helper tests.
- Unchanged: firestore rules, coach breakdown logic, calendar flow, existing per-player RSVP write API.

## Rollback
- Revert this commit to return to legacy single-doc parent RSVP behavior.
