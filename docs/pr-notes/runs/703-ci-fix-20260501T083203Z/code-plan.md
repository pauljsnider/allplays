# Code Plan

## Root Cause
- The parent dashboard page imports `./js/db.js?v=76`.
- The failing unit test still rewrites only `./js/db.js?v=76`.
- The rewrite miss leaves `requestRideSpot` undefined when the module wires rideshare handlers.

## Minimal Fix
- Change the DB import replacement regex in `tests/unit/parent-dashboard-calendar-day-modal-rsvp.test.js` to match `./js/db.js?v=\d+`.
- Do not modify production code.

## Validation
- Run the targeted Vitest file.
- Run `npm run test:unit:ci`.
