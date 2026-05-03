# QA Notes

## QA Plan
- Run the focused smoke spec covering admin invite redemption.
- Confirm the existing-user fallback test now sees the expected status text, invite code, visible code block, normalized admin email, and invite/persist calls.

## Risk Matrix
- High: Fixture drift can hide the real browser module error behind a DOM assertion. Fixed by adding the missing stub export.
- Medium: Stale cache-busted route mocks can accidentally load real modules. Fixed by matching `team-access.js?v=2`.
- Low: Product behavior changes. No product files were changed.

## Validation Command
- `npx playwright test tests/smoke/admin-invite-redemption.spec.js --config=playwright.smoke.config.js --reporter=line`
