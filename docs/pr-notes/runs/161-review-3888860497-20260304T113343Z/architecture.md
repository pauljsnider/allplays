# Architecture Role (allplays-architecture-expert)

## Current-State Read
`computeRsvpSummary` always calls `getCachedRsvpRoster`, which memoizes roster reads per team for the full page session. `submitRsvpForPlayer` now relies on `computeRsvpSummary`, so coach overrides can aggregate against stale roster membership.

## Proposed Design
Add an opt-in fresh roster mode to summary computation:
- Extend `getCachedRsvpRoster(teamId)` with an option to force refresh the cached roster promise.
- Extend `computeRsvpSummary(teamId, gameId)` with `freshRoster` option.
- Call `computeRsvpSummary(..., { freshRoster: true })` only from `submitRsvpForPlayer`.

This keeps blast radius narrow while restoring pre-regression behavior for override path.

## Files And Modules Touched
- `js/db.js`
- `docs/pr-notes/runs/161-review-3888860497-20260304T113343Z/*.md` (traceability artifacts)

## Data/State Impacts
- Cache state (`rosterPromise`) is refreshed on coach override recompute.
- No schema changes. `rsvpSummary` payload shape unchanged.

## Security/Permissions Impacts
- No access-control boundary change.
- Existing `permission-denied` and `not-found` handling preserved.

## Failure Modes And Mitigations
- Fresh roster read failure: existing error handling path remains in place.
- Increased read cost on coach override path only: acceptable due to low frequency and correctness priority.
