# QA Notes

## Root Cause Hypothesis
- The failing preview-smoke checks are caused by stale route stubs in `tests/smoke/admin-invite-redemption.spec.js`.
- `auth.js` and `team-access.js` imports were cache-busted in page code, but the smoke spec matched exact older versions.
- That prevented the intended mocked admin invite path from running and left the DOM with empty or generic status text.

## Focused Validation
- Run the targeted smoke spec:
  - `npx playwright test --config=playwright.smoke.config.js tests/smoke/admin-invite-redemption.spec.js --reporter=line`
- Run relevant unit coverage if available:
  - `npx vitest run tests/unit/admin-invite.test.js tests/unit/edit-team-admin-invites.test.js tests/unit/admin-invite-signup-cache-busting.test.js tests/unit/accept-invite-page.test.js`

## Regression Risk
- Low for production behavior. The test change only makes mocks tolerant of cache-bust version increments.
- Low for UI text. The source change only improves the fallback display name after successful admin redemption and access validation.
