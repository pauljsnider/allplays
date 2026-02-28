# Architecture Role Output

## Current-State Read
`signup` (email/password) now rethrows parent invite linking failures but does not clean up the just-created auth user. `processGoogleAuthResult` catches parent invite failure and logs only, allowing successful sign-in without parent linkage.

## Proposed Design
Introduce a small shared cleanup helper in `js/auth.js` that attempts user deletion and sign-out for newly created accounts on fail-closed parent invite paths. Apply it in both:
- `signup` parent-invite catch block.
- `processGoogleAuthResult` parent-invite catch block.

Both paths must rethrow after cleanup to enforce fail-closed behavior.

## Files And Modules Touched
- `js/auth.js`
- `tests/unit/auth-signup-parent-invite.test.js`

## Data/State Impacts
- Prevents persisted orphan auth identities when parent-link redemption fails.
- Prevents inconsistent auth session state after failed Google parent invite flows.
- No schema or Firestore rules changes.

## Security/Permissions Impacts
- Reduces authentication/authorization mismatch where users exist without required parent linkage.
- Aligns both signup channels to fail-closed semantics for invite redemption.

## Failure Modes And Mitigations
- Cleanup delete failure: log cleanup error, still sign out, and rethrow original linking error to block account usage.
- Potential behavior regression in non-parent flow: constrained edits only in `validation.type === 'parent_invite'` branches and targeted regression tests.
