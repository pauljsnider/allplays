# Architecture Role Summary

## Decision
Apply a defense-in-depth invariant at the document rule boundary for ride offers.

## Control Equivalence
- Existing control: transaction logic in `js/db.js` computes seat deltas from request status transitions.
- New control: Firestore rule blocks direct document writes from mutating `seatCountConfirmed` by arbitrary amounts.
- Combined effect: client helper integrity + backend rule-level invariant.

## Blast Radius Comparison
- Before: driver/admin direct `updateDoc` could move seat count multiple seats in one write.
- After: max movement is 1 per write; bulk tampering requires repeated writes and is rate-limited by rules checks per operation.

## Rollback Plan
Remove the one-line delta predicate from `rideOffers` `allow update` if regression discovered.
