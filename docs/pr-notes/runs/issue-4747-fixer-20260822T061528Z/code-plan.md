# Patch Plan

- Add `tests/smoke/team-pass-checkout.spec.js` with a minimal routed HTML harness around the real Team Pass module.
- Stub only Firebase Auth, App Check, team access, premium access configuration, checkout creation, and external navigation.
- Add a valid-flow regression for request shape, pending lock, duplicate prevention, and exact canonical navigation.
- Add table-driven invalid-destination regressions for HTTP and Stripe-hostname lookalikes.
- Leave production code, Playwright configuration, and package scripts unchanged.

# Code Changes Applied

Planning lane only. The main lane owns all edits.

# Validation Run

- Discovery: `npx playwright test tests/smoke/team-pass-checkout.spec.js --config=playwright.smoke.config.js --project=smoke --list`
- Focused execution: `npx playwright test tests/smoke/team-pass-checkout.spec.js --config=playwright.smoke.config.js --project=smoke --reporter=line`

# Residual Risks

- External navigation must be fulfilled locally.
- The deferred checkout response must always be released.
- Duplicate simulation must use `dispatchEvent` because the button is disabled.
- Stub exports must track the imported module surface; early page-error checks expose drift.

# Commit Message Draft

`Add Team Pass checkout smoke coverage (#4747)`
