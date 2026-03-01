# Architecture Role Notes

## Current State
`signup()` creates Firebase Auth user first. Parent-invite linkage failures currently rethrow but leave Auth account alive.

## Proposed State
Mirror Google new-user cleanup semantics in email/password parent-invite branch:
- best-effort `userCredential.user.delete()`
- `signOut(auth)` in both success and delete-failure paths
- rethrow original parent-invite error

## Control Equivalence
Improves control parity with existing Google flow and reduces identity-store/Firestore divergence.

## Rollback
Single-hunk revert in `js/auth.js` parent-invite catch block.
