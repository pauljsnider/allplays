# Architecture Role Synthesis

## Current state
- `validateAccessCode` performs non-locking read.
- `markAccessCodeAsUsed` performs blind `updateDoc` overwrite.
- `redeemParentInvite` reads unused code, performs profile/player writes, then marks used.

## Proposed state
- Move single-use claim into Firestore transaction for generic code consumption (`markAccessCodeAsUsed`).
- Parent invite redemption starts with transaction-based code claim (`used=false -> true`) before downstream writes.
- If downstream parent invite writes fail after claim, rollback claimed code to unused for same claimant.

## Blast radius
- Limited to access-code redemption semantics in `js/db.js` and signup error handling in `js/signup-flow.js`.
- No schema change.

## Risks
- Rollback path could fail and leave code consumed; handled by throwing explicit error and logging.
- Existing flows relying on best-effort success may now fail closed when code claim fails (intended).
