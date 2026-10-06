# Architecture Review — Issue #4985

## Root Cause

The existing transaction is concurrency-safe only for one item at a time. Its private scalar API and the delegated rule's exact `+1` predicate prevent one atomic reservation for a batch and leave no shared bounded-range contract.

## Minimal Safe Design

Add `reserveTeamMediaOrderRange(teamId, folderId, count = 1)` in `js/db.js`:

1. Normalize required identifiers and validate `count` as an integer in 1–20 before Firestore.
2. Run exactly one transaction and read the target folder once.
3. Treat an absent legacy counter as zero. Use only a non-negative integer stored counter; fall back to zero for the legacy invalid-counter behavior rather than issuing non-integer orders.
4. Update `nextMediaOrder` to `start + count` with `updatedAt`.
5. Return `Array.from({ length: count }, (_, index) => start + index)`.

Keep a private scalar wrapper that calls the range primitive with one and returns its first value. That preserves every existing link/photo/file payload and cleanup path while ensuring a single allocation implementation.

Firestore transaction retries serialize competing writes to the same folder. Therefore concurrent reservations commit disjoint ranges, regardless of which caller wins first. Never decrement the counter after downstream item failure.

## Firestore Rules

Retain the upload grant, team-visible folder, affected-field allowlist, and request-time timestamp checks. Require the old/default counter and requested counter to be non-negative integers, then require a delta from 1 through 20. The delegated helper remains separate from full manager authority.

## Adjacent Obligations

- Update stale `+1` source assertions in Team Media wiring tests.
- Add emulator-backed rule behavior, not only source-text checks, and wire the test into rules CI.
- Because `js/db.js` is cache-critical, raise its shared production import version uniformly and follow the transitive importer graph until `scripts/check-critical-cache-bust.mjs` passes.
- No page imports the new export in this slice, so no smoke stub needs a new named export.

## Risks

- Authorization drift is medium risk unless client bounds and rule bounds stay paired.
- Duplicate allocation is low risk with one transaction per range and concurrency regression coverage.
- Wasted orders are expected after downstream failure.
- Cache-version drift is high risk unless the complete transitive cohort is updated and guarded.
