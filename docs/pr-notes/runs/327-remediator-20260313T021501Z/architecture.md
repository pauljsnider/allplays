Current state: admin invite redemption performs a preflight read, grants coach role on the user doc, then runs a transaction to append `adminEmails` and consume the access code.

Proposed state: keep the flow intact and add an `expiresAt` guard in `redeemAdminInviteAtomicPersistence(...)` both before the user grant and inside the transaction, matching the existing standard-code fail-closed pattern.

Blast radius:
- Limited to admin invite redemption in `js/db.js`.
- One focused unit test to lock the regression.

Tradeoff:
- Duplicate expiration checks are intentional here because the code performs reads both before and during the transaction.
