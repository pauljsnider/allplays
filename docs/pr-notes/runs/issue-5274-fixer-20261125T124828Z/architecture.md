# Architecture Analysis

## Root cause

`buildBalanceAdjustmentUpdate` derives balances from rendered DOM state. `updateTeamFeeRecipient` reads the latest recipient in a transaction but only rebases manual payments, so adjustment balance fields, nested metadata, ledger history, and `adminBilling/latest` are written from the stale client snapshot. The transaction serializes writes without making the calculation transactional.

## Minimal safe design

1. Treat signed `adjustment.amountCents` as mutation intent.
2. Detect all balance adjustments and route them through the existing Firestore transaction.
3. Read authoritative amount due and amount paid using existing legacy fallbacks.
4. Compute `newDue = max(0, storedDue - delta)`, remaining balance, and status from transaction-read state.
5. Override client-derived top-level and nested values before auditing.
6. Reconcile balance-adjustment ledger entries and private admin-billing metadata to the same before/after transition.
7. Reject missing, zero, non-finite, or contradictory deltas.

## Invariants and risk

- Recipient balance, nested adjustment, ledger entry, admin billing, and audit fields describe one authoritative transition.
- Existing payments are preserved and checkout invalidation remains atomic with the update.
- No new export is required, so smoke stubs need no symbol change.
- `js/db.js` is cache-critical; bump its uniform importer cohort and the transitive `team-fees-admin.js` consumer version.

Recurrence risk is medium because the update API still accepts both mutation intent and derived fields; future financial mutation types must rebase derived state transactionally.
