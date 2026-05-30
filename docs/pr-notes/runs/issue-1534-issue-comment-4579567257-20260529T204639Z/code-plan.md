# Code Plan, Issue #1534 Follow-up

## Implemented Patch
- `registration.html`: wraps `initiateStripeCheckout(...)` so thrown failure releases `result.registrationId`, clears `preparedCheckoutRegistration`, and shows the existing payment initiation error. Empty URL releases the same prepared registration, clears retry state, and shows the existing checkout URL error.
- `functions/index.js`: introduces `checkoutIsOpen` and `canReleasePreCheckoutReservation`; release is allowed for unpaid pre-checkout `pending`/`waitlisted` reservations with no checkout/payment status.
- `tests/unit/registration-flow.test.js`: updates stale capacity expectation, verifies release/reset strings, verifies retry prepares a fresh reservation, verifies no-URL release behavior, and checks server guard strings.

## Conflict Resolution
All lanes aligned on the minimal reserve-first cleanup. No broader payment architecture change was made.
