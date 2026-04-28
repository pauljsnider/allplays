# QA Notes

## QA Plan
- Run the focused smoke spec covering admin invite redemption.
- Confirm the existing-user fallback status, invite code, visible code block, normalized admin email, and invite/persist calls.

## Risk Matrix
- High: fixture drift can hide module initialization errors behind a later DOM assertion.
- Medium: stale cache-busted route mocks can accidentally load real modules.
- Low: product regression risk, because no production files are changed.

## Validation Command
- `npx playwright test --config=playwright.smoke.config.js tests/smoke/admin-invite-redemption.spec.js --reporter=line`
