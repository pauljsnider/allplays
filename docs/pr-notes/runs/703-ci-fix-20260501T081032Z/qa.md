# QA note

## QA Plan
- Run `GITHUB_EVENT_NAME=pull_request GITHUB_BASE_REF=master node scripts/check-critical-cache-bust.mjs` to reproduce the CI guard locally.
- Run targeted unit coverage for the changed parent dashboard fee work if available: `npx vitest run tests/unit/parent-dashboard-fees.test.js tests/unit/parent-dashboard-calendar-day-modal-rsvp.test.js`.

## Expected Result
- Cache-bust guard passes because the diff now includes a `db.js?v=<number>` change.
- Existing parent dashboard tests remain green.
