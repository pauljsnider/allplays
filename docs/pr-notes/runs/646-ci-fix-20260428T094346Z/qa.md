# QA Notes

## Failure interpretation
The existing-user admin invite smoke failed because the status element stayed empty. The highest-confidence cause is smoke stub drift: `edit-team.html` imports named functions that the Playwright route stubs did not provide, which can stop module initialization before the save handler is registered.

## Validation performed
- `npx vitest run tests/unit/edit-team-admin-invites.test.js tests/unit/edit-team-admin-access-persistence.test.js --reporter=dot`
  - Result: passed, 2 files / 14 tests.
- `npm test -- --run tests/unit/edit-team-admin-invites.test.js tests/unit/edit-team-admin-access-persistence.test.js`
  - Result: passed, 166 files / 753 tests. The npm script ignored the narrower file arguments and ran the full unit suite.

## Validation blocked locally
- `npx playwright test --config=playwright.smoke.config.js --reporter=line tests/smoke/admin-invite-redemption.spec.js`
  - Blocked because local Playwright Chromium executable is not installed in this workspace.

## Regression checks expected in CI
- `tests/smoke/admin-invite-redemption.spec.js` should load `edit-team.html` without module import errors.
- Existing-user admin invite fallback should show the inline status, expose code `EXIST111`, render the code panel, and persist normalized `coach@example.com` in the admin list.
- Admin invite redemption should still redirect to dashboard access.
