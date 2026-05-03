# Code Plan

## Patch Plan
1. Bump `team.html` db import from `v=15` to a fresh token, `v=17`, to avoid cached `db.js` without the new export.
2. Add a default-false `skipAvailabilityCutoff` option to `submitRsvpForPlayer` in `js/db.js`.
3. Wrap the Game Day RSVP controller's injected `submitRsvpForPlayer` in `game-day.html` so coach override writes pass `skipAvailabilityCutoff: true`.
4. Bump `game-day.html` db import to `v=17` so the new option is loaded immediately after deploy.

## Validation Plan
- Run targeted `tests/unit/game-day-rsvp-controls.test.js`.
- Run full unit suite if feasible.

## Notes
- The code role subagent did not complete analysis beyond loading its skill, so these notes are the inline fallback analysis required by the remediator workflow.
