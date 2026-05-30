# QA, Issue #1534 Follow-up

## Regression Strategy
- Verify thrown checkout initiation releases the prepared registration.
- Verify missing checkout URL releases the prepared registration.
- Verify retry creates a fresh reservation and capacity returns to `{ enrolled: 0, waitlisted: 0 }`.
- Verify server source keeps paid/open checkout protections and idempotent already-released behavior.

## Validation Gates
- `npm ci`
- `npm ci --prefix apps/app`
- `npx vitest run tests/unit/registration-flow.test.js tests/unit/stripe-service.test.js --reporter=dot`
- `npm run ci:firebase-rules`
- `git diff --check`

## CI Notes
Targeted registration/Stripe tests pass. Full unit CI and preview smoke currently fail in schedule tests unrelated to registration checkout: `tests/unit/app-schedule-desktop-controls.test.jsx` waits for `Main Gym`, and preview smoke schedule tests see missing expected schedule cards/counts.
