# Architecture, Issue #1534 Follow-up

## Decision
Preserve reserve-first semantics for concurrency. Add cleanup only in the gap after reservation creation and before a usable Stripe checkout URL exists.

## State Transitions
- Success: pending registration -> capacity increment -> checkout open -> Stripe redirect.
- Failure before URL: pending/waitlisted registration -> capacity increment -> checkout failure/no URL -> release callable -> capacity decrement -> registration released/cancelled.

## Guard Boundary
`releaseRegistrationCheckoutCapacity` now permits unpaid pre-checkout `pending`/`waitlisted` records with no checkout/payment status. Paid and already-released guards remain before mutation.

## Blast Radius
One registration document and one registration form capacity counter. No rules broadening, migration, or schema expansion.

## Rollback
Revert `registration.html`, `functions/index.js`, and `tests/unit/registration-flow.test.js` changes.
