## QA Focus
Prevent regression from atomic append back to read-modify-write for admin invite acceptance.

## Tests Added
- Static regression test on `js/db.js` ensuring:
- `runTransaction` is present in `redeemAdminInviteAtomicPersistence`.
- team update uses `adminEmails: arrayUnion(normalizedEmail)`.

## Validation Commands
- `pnpm dlx vitest run tests/unit/admin-invite-redemption.test.js tests/unit/admin-invite-atomic-persistence-guard.test.js`

## Residual Risk
This is a source-level guard, not a Firestore emulator concurrency test. Follow-up can add emulator-based concurrent redemption coverage.
