# Requirements Role - PR #102 Review 3870770986

## Objective
Close the expiration boundary bug for parent invite redemption and ensure coverage for supported expiration value shapes.

## User impact
- Parents should be blocked from redeeming an invite at or after the configured expiration instant.
- Behavior must stay deterministic regardless of whether expiration arrives as Firestore Timestamp-like object, Date, or numeric epoch milliseconds.

## Acceptance criteria
1. `isAccessCodeExpired` returns `true` when `nowMs === expiresAt`.
2. Existing Timestamp-like past/future behavior remains unchanged.
3. Unit tests include Date input, numeric timestamp input, and boundary equality case.
4. No regression in missing-expiration behavior.

## Assumptions
- Product intent treats expiration as inclusive boundary (`>=`).
- Utility is the single source for this comparison in invite redemption.
