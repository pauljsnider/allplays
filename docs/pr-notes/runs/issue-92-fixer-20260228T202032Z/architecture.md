# Architecture role output (manual fallback)

Chosen approach:
- Introduce `js/access-code-utils.js` with a small pure helper to evaluate `expiresAt` values from Firestore `Timestamp`, number, or `Date`.
- Reuse helper inside `redeemParentInvite` in `js/db.js` and fail closed before mutation steps.

Why this path:
- Minimal patch footprint.
- Improves consistency with existing expiration semantics already present in `validateAccessCode`.
- Keeps logic testable without Firebase runtime dependencies.

Control and rollback:
- No data migration and no rules change.
- Rollback is single-file logic revert in `db.js` (and helper if needed).
