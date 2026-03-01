# Architecture Role Summary

## Decision
Keep fail-closed cleanup local to `signup` parent-invite catch block with two isolated cleanup attempts.

## Why
- Minimal blast radius and no cross-flow behavior drift.
- Preserves control equivalence: account deletion intent plus explicit auth session termination.
- Prevents cleanup exceptions from shadowing the true business failure.

## Controls
- Auditability: explicit logging for delete and sign-out cleanup failures.
- Access/session control: explicit `signOut(auth)` attempted regardless of delete result.
- Segregation: no changes to Firestore rule paths or unrelated auth flows.

## Assumptions
- `createUserWithEmailAndPassword` completes before parent invite finalization.
- Caller already handles thrown errors and user-facing messaging.
