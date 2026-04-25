# Code Plan

## Recommended Fix
Bump all direct `auth.js` consumer pins from prior versions to `auth.js?v=12` so the updated signup cleanup logic is fetched consistently across the site.

## File Scope
- HTML entry points that import `./js/auth.js`
- JS modules that import `./auth.js`
- Unit and smoke tests that assert or stub the versioned auth path
- `scripts/build-help-workflow-html-loop.mjs` to keep generated workflow pages aligned

## Exact Strategy
1. Replace `auth.js?v=10` and `auth.js?v=11` with `auth.js?v=12` in tracked repo consumers.
2. Leave unrelated module versions unchanged.
3. Keep existing auth behavior and tests intact.
4. Commit as a narrow cache-bust follow-up on the PR branch.

## Validation Commands
- `npx vitest run tests/unit/auth-signup-parent-invite.test.js tests/unit/admin-invite-signup-cache-busting.test.js tests/unit/accept-invite-page.test.js tests/unit/calendar-day-modal-rsvp.test.js tests/unit/parent-dashboard-calendar-day-modal-rsvp.test.js tests/unit/live-tracker-opponent-stats.test.js`
- `GITHUB_EVENT_NAME=pull_request GITHUB_BASE_REF=master node scripts/check-critical-cache-bust.mjs`

## Note
- Required role subagent spawn was attempted but unavailable due local gateway session closure, so this artifact is a main-run synthesis for traceability.
