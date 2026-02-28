# Requirements Role Summary

## Objective
Confirm signup fails closed when parent invite linking throws, and no profile document is created.

## Acceptance Criteria
1. Email/password parent-invite signup throws the invite-linking error.
2. Cleanup executes for failed new user (`delete` + `signOut`).
3. `updateUserProfile` is never called in the failure path.
4. Standard code path behavior remains unchanged.

## Risk Notes
- PHI/tenant risk is reduced by fail-closed behavior preventing orphan parent associations.
