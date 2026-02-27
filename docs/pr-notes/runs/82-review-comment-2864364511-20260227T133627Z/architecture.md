# Architecture Role Summary

## Decision
Use a Firestore transaction in data layer (`redeemAdminInviteAtomically`) as the control point.

## Why
- Transactions provide compare-and-set semantics on `accessCodes/{codeId}.used`.
- Team admin email and user coach role updates can be performed in the same atomic transaction, eliminating split-phase race.

## Risk and Controls
- Risk: If transaction fails, no partial writes are committed.
- Control equivalence: stronger than previous flow because privilege grant and code consumption now share one commit boundary.

## Tradeoff
- Requires user profile email to exist at redemption time for admin email list updates; if absent, coach role still granted atomically and code still consumed.
