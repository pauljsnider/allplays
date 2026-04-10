# Architecture Role Notes

Thinking level: medium (auth + Firestore side-effect ordering).

## Current state
Parent invite signup does auth user creation, invite redemption, and profile write. Cleanup and error handling exist but should be structurally explicit to avoid broad failure coupling.

## Proposed state
Use a dedicated helper that wraps only invite-linking (`redeemParentInvite`) with cleanup + rethrow. Keep profile writes in a separate best-effort try/catch.

## Blast radius
- Limited to parent invite signup code paths in `js/auth.js`.
- No schema/rules/API changes.
- Improves control equivalence by preserving fail-closed semantics only for invite-linking errors.
