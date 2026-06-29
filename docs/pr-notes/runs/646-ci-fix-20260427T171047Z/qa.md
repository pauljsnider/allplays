# QA Notes

## Root Cause Hypothesis
- The smoke test route fulfills `js/db.js?v=76` with `EDIT_TEAM_DB_STUB`, but that stub does not export every symbol imported by `edit-team.html`.
- Browser ES module linking fails before the page registers the `#save-admin-btn` listener, so the test click is a no-op and `#admin-invite-status` stays empty.

## Targeted Validation
- Run `npx playwright test --config=playwright.smoke.config.js --reporter=line tests/smoke/admin-invite-redemption.spec.js`.
- Optionally run the full preview smoke command if time permits.

## Regression Risk
- Low. This only aligns the smoke mock with the production module import surface.
