# Code Plan

1. Add a failing transaction regression in `tests/unit/db-team-fee-recipient-updates.test.js` using stale client-derived balance fields and a newer transaction snapshot.
2. Detect balance adjustments in `updateTeamFeeRecipient` and require the transaction path.
3. Resolve a finite, nonzero signed delta from nested adjustment or ledger intent; reject contradictory sources.
4. Recompute amount due, remaining balance, and status from transaction-read due and paid totals.
5. Rebuild nested adjustment, balance-adjustment ledger entries, and private admin-billing before audit comparison and writes.
6. Update the adjustment-only test to require a transaction.
7. Increase the shared `db.js?v=` value across every production importer, bump transitive importer versions, and update exact-version assertions.
8. Run the focused unit tests, cache-bust guard, and whitespace check before committing.

No new exports or imports are required. Keep UI behavior, zero-floor semantics, sanitization, and checkout invalidation unchanged.
