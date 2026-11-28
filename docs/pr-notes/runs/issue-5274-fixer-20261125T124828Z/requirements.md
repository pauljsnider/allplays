# Requirements Analysis

## User impact

A fee balance is shared financial state. Every accepted adjustment must remain reflected in the amount owed; retaining both ledger entries while losing part of their combined effect can overcharge or undercharge a family.

- Administrators and coaches must be able to adjust a recipient from a stale tab without undoing another administrator's work.
- Parents must see an amount owed that agrees with the complete adjustment history.
- Sports managers must be able to reconcile recipient balances against the ledger and audit trail.
- Existing positive-credit and negative-charge semantics must remain unchanged.

## Acceptance criteria

1. Persist a balance adjustment as a signed delta applied to the latest recipient state inside the Firestore transaction.
2. An authoritative $100 balance followed by stale-page credits of $20 and $10 results in $70 owed.
3. Do not trust client-derived balance, status, previous-balance, or paid-total fields.
4. Recompute remaining balance and status using the latest stored paid amount.
5. Reconcile nested adjustment metadata, ledger history, and private admin-billing metadata to the authoritative transaction values.
6. Preserve actor attribution, reason, checkout invalidation, sanitization, and existing validation.
7. Cover the stale snapshot at the database transaction boundary with a prevention-oriented regression test.

## Edge cases and scope

- A racing payment must be included in the transaction-read paid total.
- A credit larger than the latest balance keeps the existing zero floor.
- A negative adjustment may reopen a paid balance.
- Existing legacy amount aliases remain supported.
- Applying the delta is preferred to rejecting a stale page because it preserves the administrator workflow.
- Network retry idempotency is related but outside this targeted fix.
