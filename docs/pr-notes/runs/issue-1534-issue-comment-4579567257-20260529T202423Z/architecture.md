# Architecture, Issue #1534

## Decision
Keep the existing reserve-first registration flow to preserve concurrent capacity protection. Add a narrow failure cleanup after a registration is prepared but before a Stripe checkout URL exists.

## State Transitions
- Success: create pending registration -> increment capacity -> create Stripe checkout -> mark checkout open -> navigate to Stripe.
- Failure before URL: create pending registration -> increment capacity -> checkout throws/no URL -> call cancellation/release function -> decrement matching count -> mark registration released/cancelled.

## Server Guard
`releaseRegistrationCheckoutCapacity` now allows unpaid pre-checkout `pending` or `waitlisted` registrations with no checkout/payment status to be released. The paid guard remains before any registration write, and idempotency remains enforced by `registrationCapacityReleased`.

## Blast Radius
Scoped to one registration document and one registration form capacity counter. No Firestore rule broadening.

## Rollback
Revert `registration.html`, `functions/index.js`, and the regression test updates. Existing successful checkout behavior is otherwise unchanged.
