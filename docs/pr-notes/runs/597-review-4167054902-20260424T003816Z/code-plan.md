# Code Plan

## Suspected Root Cause
The edit-schedule smoke fixtures drifted behind PR #597:
- `edit-schedule-calendar-cancelled-import.spec.js` still intercepted `js/db.js?v=20` exactly.
- Both focused smoke specs stubbed `db.js` without the newly imported `saveTournamentPoolOverride` and `clearTournamentPoolOverride` exports.

## Minimal Patch Plan
- Add no-op exports for the two new DB helpers in both smoke specs.
- Add a lightweight `tournament-standings.js` stub in both smoke specs.
- Make the cancelled-import `db.js` route query-tolerant.

## Test Additions
- None beyond fixture updates. Existing focused smoke coverage already exercises the broken workflows.

## Risks
- If production runtime is also broken, test-only fixture alignment would not catch it. Keep unit coverage and preview-smoke as the decision gate.