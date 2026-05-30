# QA, PR #1549 Follow-up

## QA Plan
- Unit-cover token persistence, omitted-token behavior, service forwarding, function guard wiring, and page plumbing.
- Validate Firebase rules accept the new optional public registration field.
- Verify whitespace with `git diff --check`.

## Regression Cases
- Stripe initiation throws: matching token releases the prepared reservation and allows retry.
- Stripe returns no checkout URL: matching token releases the prepared reservation.
- Stripe cancel return: token from the return URL is sent to cancellation.
- Stale/wrong token: callable rejects checkout release/creation for tokenized registration.
- Paid/already-released registrations remain protected.

## Commands
- `npx vitest run tests/unit/registration-flow.test.js tests/unit/stripe-service.test.js --reporter=dot`
- `npm run ci:firebase-rules`
- `git diff --check`
