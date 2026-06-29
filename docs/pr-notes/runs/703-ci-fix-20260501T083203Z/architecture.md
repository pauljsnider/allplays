# Architecture Notes

## Current State
- PR #703 CI failure is caused by test harness coupling, not production runtime behavior.
- `parent-dashboard.html` imports `requestRideSpot` from `./js/db.js?v=76`.
- `tests/unit/parent-dashboard-calendar-day-modal-rsvp.test.js` rewrites only `./js/db.js?v=76`, so the DB import replacement misses and `requestRideSpot` is never bound in the evaluated dashboard module.

## Decision
- Keep production code unchanged.
- Update the test harness DB import rewrite to be cache-bust-version agnostic.

## Risk And Rollback
- No data, auth, Firestore, or runtime behavior impact.
- Rollback is reverting the single test harness regex change.
