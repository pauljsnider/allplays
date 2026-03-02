# Requirements Role Summary

## Objective
Ensure email/password signup fails closed for parent-invite finalization failures so users are not left authenticated after reported failure.

## Current State
`signup` creates Firebase Auth user first, then performs parent invite redeem/profile writes. Failure handling attempted cleanup, but sign-out was coupled to delete flow and could mask the original failure path.

## Proposed State
On parent-invite finalization error:
- attempt `userCredential.user.delete()` best-effort
- independently attempt `signOut(auth)` regardless of delete outcome
- always rethrow the original parent-invite error to preserve caller semantics

## Risk Surface and Blast Radius
- Scope limited to parent-invite branch in `signup`.
- No change to coach/admin signup branch.
- Reduced auth/session residue risk and retry-blocking (`email-already-in-use`) risk after failed parent linking.

## Acceptance Criteria
- Parent-invite finalization errors still throw to caller.
- Cleanup path contains both delete and sign-out attempts.
- Sign-out failure does not replace the original parent-invite error.
