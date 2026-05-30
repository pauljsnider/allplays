# QA, Issue #1534

## Regression Coverage
- Thrown checkout initiation error releases a prepared registration and clears retry state.
- Missing checkout URL releases the prepared registration and clears retry state.
- Capacity-backed retry creates a fresh reservation instead of reusing a released registration.
- Paid-registration server guard remains before any cancellation write.
- Server source guard permits unpaid pre-checkout pending/waitlisted release while preserving open-checkout cancellation.

## Validation Commands
- `npm ci`
- `npx vitest run tests/unit/registration-flow.test.js tests/unit/stripe-service.test.js --reporter=dot`
- `npm run test:unit:ci`
- `npm run ci:firebase-rules`

## Impacted Workflows
- Public `registration.html` online Stripe checkout.
- Registration option capacity counters.
- Stripe checkout cancellation/release callable.
