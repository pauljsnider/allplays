# QA Notes

## Acceptance criteria
- `edit-team.html?teamId=team-1` initializes under the smoke-test dependency stubs without browser module-link errors.
- The existing-user admin invite flow calls the mocked invite and persistence functions.
- `#admin-invite-status` shows the existing-account fallback, the invite code is visible, and the admin list includes the normalized email.

## Validation plan
Run the targeted Playwright smoke spec:

`npx playwright test tests/smoke/admin-invite-redemption.spec.js --config=playwright.smoke.config.js --reporter=line`

This covers the failed check and the companion accept-invite redemption path.
