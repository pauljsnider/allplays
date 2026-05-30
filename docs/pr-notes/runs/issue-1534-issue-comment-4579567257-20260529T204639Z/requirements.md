# Requirements, Issue #1534 Follow-up

## Problem
Stripe checkout initiation failures can consume registration option capacity even though the parent never reaches Stripe or pays.

## Acceptance Criteria
1. Thrown checkout initiation after capacity reservation releases the prepared registration and restores option capacity.
2. Missing or empty checkout URL releases the prepared registration and restores option capacity.
3. Retry after either failure creates a fresh reservation rather than reusing released `preparedCheckoutRegistration` state.
4. Successful checkout still redirects to Stripe and leaves capacity reserved.
5. Paid, open-checkout, and already released registrations are not downgraded or double-released.
6. Enrolled and waitlisted pre-checkout reservations can both be released when checkout never opens.

## Non-Goals
- No payment flow redesign.
- No webhook changes.
- No historical cleanup migration.
- No new admin UI.
