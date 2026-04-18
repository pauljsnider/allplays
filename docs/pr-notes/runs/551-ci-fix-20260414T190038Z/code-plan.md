# Code Plan

## Files To Change
- `tests/unit/admin-invite-signup-cache-busting.test.js`

## Proposed Edit
- Change the stale cache-busting expectation for `./js/accept-invite-flow.js` from `?v=4` to `?v=5` so it matches `accept-invite.html` and the existing passing page test.

## Validation
- `npx vitest run tests/unit/admin-invite-signup-cache-busting.test.js tests/unit/accept-invite-page.test.js`

## Commit Description
- `fix:address-ci-failure: align admin invite cache busting test with v5 import`
