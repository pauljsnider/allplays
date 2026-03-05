# Architecture Analysis
- Affected boundary: client-side Firestore data access helper `redeemParentInvite` in `js/db.js`.
- Data shape: `/accessCodes` docs can be non-unique by `code` due to `addDoc` creation path.
- Safe fix pattern: filter candidate docs to `type === 'parent_invite'`, then prefer `used !== true` and `!isAccessCodeExpired(expiresAt)` before selecting a document reference for transaction.
- Blast radius: limited to parent invite redemption lookup; no schema or API contract changes.
