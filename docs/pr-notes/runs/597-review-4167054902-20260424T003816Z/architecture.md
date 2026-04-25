# Architecture

## Current State
PR #597 adds new `db.js` named imports and a new `tournament-standings.js` module. Existing smoke fixtures for edit-schedule were still pinned to the old `db.js?v=20` route shape and older export surface.

## Proposed State
Leave application behavior unchanged. Update smoke fixtures so their stubbed module contract matches the new import surface and stays tolerant of query-string cache busting.

## Architecture Decisions
- Fix the regression in smoke fixtures, not production code.
- Add no-op exports for `saveTournamentPoolOverride` and `clearTournamentPoolOverride` in edit-schedule smoke stubs.
- Stub `tournament-standings.js` in the focused smoke specs so unrelated standings logic does not leak into calendar import coverage.
- Match `js/db.js` with a query-tolerant route in the cancelled-import smoke spec.

## Blast Radius
Low. Test-only change scoped to two edit-schedule smoke specs.

## Rollback
Revert the two smoke spec edits if they hide a production defect, then re-open investigation against `edit-schedule.html` runtime behavior.