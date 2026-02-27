# Architecture role output

## Root cause
`signup()` and Google new-user setup both wrap `redeemParentInvite()` in `try/catch` and intentionally continue after errors.

## Minimal design
- Introduce a focused helper module to finalize parent invite signup.
- Helper responsibilities:
  - redeem parent invite,
  - create baseline profile,
  - on failure, invoke rollback callback and throw a normalized user-facing error.
- Call helper from both email/password signup and Google new-user parent invite branch.

## Blast radius
- Low and targeted to auth onboarding code paths.
- No schema/rules changes.
- No changes to redirect logic required; thrown errors already surface in login page handlers.

## Control equivalence
- Improves integrity: invite onboarding cannot partially succeed.
- Limits orphaned account risk by attempting immediate auth rollback.
- Existing audit trails for code redemption and profile writes remain unchanged.

## Rollback
- Revert helper usage in `js/auth.js` and remove helper module/tests.
