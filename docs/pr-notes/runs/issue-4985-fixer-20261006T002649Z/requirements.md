# Requirements Analysis — Issue #4985

## Objective

Add a narrow data-layer primitive that reserves a contiguous Team Media order range for 1–20 items in one folder-counter transaction. Concurrent callers must receive disjoint ranges, and existing single-item link/photo/file behavior must remain unchanged through the new primitive. This slice does not change either upload workflow.

## Root Cause / Missing Behavior

`js/db.js` has only a private `reserveNextTeamMediaOrder` helper that hard-codes a `+1` transaction and returns one scalar. `firestore.rules` duplicates that `+1` assumption for delegated contributors and accepts any `number`, including fractional values. A future batch would therefore need one transaction per item, while delegated rules would reject a legitimate bounded range reservation.

## Required Contract

- Export a reservation primitive accepting team, folder, and an integer count from 1 through 20.
- Reject invalid counts before invoking Firestore.
- A valid call performs exactly one transaction, reads the folder, advances `nextMediaOrder` by the count, and returns exactly that many ascending values.
- Missing legacy counters start at zero; missing folders retain the existing user-safe error.
- Concurrent reservations against one folder may commit in either order, but their ranges must not overlap.
- Existing single-item paths reserve a count of one through the same implementation.
- Once issued, orders are consumed. A later item failure may leave a gap; it must never trigger reuse or produce duplicate successful orders.

## Delegated Rules Contract

A delegated counter update is allowed only when the folder is team-visible, the caller has an upload grant, only `nextMediaOrder` and `updatedAt` change, the counter delta is an integer from 1 through 20, and `updatedAt == request.time`. Reject zero, negative, fractional, greater-than-20, private-folder, unrelated-field, missing-grant, and invalid-timestamp updates. Full Team Media managers retain existing authority.

## Product Interpretation

Coaches, parents, and sports managers perceive a multi-file selection as one batch. Reserving once reduces contention and gives that batch predictable internal order. Dense numbering is less important than monotonic uniqueness, so abandoned slots are acceptable and invisible sorting behavior remains stable.

## Out of Scope

Do not change React or legacy upload workflows, progress messaging, storage paths/rules, album sorting, pagination, notifications, server processing, or move/delete/reorder behavior.

## Recurrence Prevention

Treat the transaction and its Firestore authorization predicate as one behavioral contract. Any future increment-shape change must update both sides and cover lower/upper bounds, integer type, concurrency, unrelated fields, visibility, and failure-after-reservation gaps.
