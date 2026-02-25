# QA Role Notes (Issue #53 Rideshare)

## Objective
Validate rideshare helper logic and parent dashboard integration safety for the MVP flow.

## Automated Validation
- `./node_modules/.bin/vitest run tests/unit/rideshare-helpers.test.js`
- `./node_modules/.bin/vitest run tests/unit/*.test.js`
- `node --check js/rideshare-helpers.js`

## Manual Validation Checklist
1. Parent opens `parent-dashboard.html` with a DB-backed upcoming game or practice.
2. Create an offer with seat count/direction/note and confirm offer appears with seat chips.
3. As another parent on same team, request a spot for a linked child and verify status appears as pending.
4. As offer driver, confirm request and verify seat counts decrement/increment correctly.
5. Attempt to confirm over-capacity request and verify UI error (offer remains bounded).
6. Verify rideshare UI appears in both list card and day-modal views for the event.

## Residual Risk
- Per-event reads can increase dashboard load time for families with many upcoming events.
- UI deduplication complexity in calendar/day modal remains moderate; future refactor could centralize event card rendering.
- Rules should be emulator-tested in a future pass for edge-case field diffs.
