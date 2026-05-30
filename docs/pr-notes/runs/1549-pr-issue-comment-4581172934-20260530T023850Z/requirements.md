# Requirements, PR #1549 Follow-up

## Acceptance Criteria
- Generate a unique checkout attempt token before creating an online Stripe registration reservation.
- Persist the token only when the public online checkout flow creates the registration.
- Pass the same token through checkout creation, Stripe metadata, return URLs, and cancellation/release calls.
- Reject checkout creation when a registration has a different current attempt token.
- Reject reservation release when the stored token and supplied token do not match.
- Preserve paid, checkout-open, already-released, and non-releasable guards.
- Keep legacy no-token records compatible, but do not broaden public release access for tokenized registrations.

## UX And Operations Notes
- Parents should see the same simple retry messaging when Stripe cannot start.
- Program counts should recover after failed/no-URL checkout starts and remain stable on stale cancels.
- Operators should not need a migration for existing registrations.

## Risks
- Stale tabs and Stripe returns are the primary risk surface.
- Token handling must be scoped to one registration attempt and must not affect broader team/form access.
