# QA Plan

## Primary Risk
Users hit cached `auth.js` from pre-fix deploy paths and miss the fail-closed Google signup cleanup behavior.

## Regression Risks
- HTML pages still referencing old `auth.js?v=` values.
- JS modules importing stale auth version.
- Tests and smoke stubs intercepting old versioned URLs.

## Automated Checks
- `npx vitest run tests/unit/auth-signup-parent-invite.test.js tests/unit/admin-invite-signup-cache-busting.test.js tests/unit/accept-invite-page.test.js tests/unit/calendar-day-modal-rsvp.test.js tests/unit/parent-dashboard-calendar-day-modal-rsvp.test.js tests/unit/live-tracker-opponent-stats.test.js`
- `GITHUB_EVENT_NAME=pull_request GITHUB_BASE_REF=master node scripts/check-critical-cache-bust.mjs` after the cache-bust update is committed.

## Manual Spot Check
- Open `login.html` and confirm it imports `./js/auth.js?v=12`.
- Open one JS consumer such as `js/admin.js` and confirm it imports `./auth.js?v=12`.

## Exit Criteria
- Unit tests above pass.
- Cache-bust guard passes against the committed PR diff.

## Note
- Required role subagent spawn was attempted but unavailable due local gateway session closure, so this artifact is a main-run synthesis for traceability.
