# Requirements Role Notes

Thinking level: medium (multiple linked failure paths, but narrow code scope).

## Objective
Resolve unresolved PR #100 review threads by ensuring parent invite signup cleanup and failure semantics are correct and test-covered.

## Required outcomes
- If parent invite redemption fails after Auth user creation, delete/sign out the newly created auth user before failing.
- Signup tests must verify profile creation does not run when invite redemption fails.
- Parent invite flow must only fail hard on invite-linking failure; profile write failures after successful redemption must remain best-effort.

## Assumptions
- `redeemParentInvite` is the operation that consumes/links invite state.
- Profile writes are non-critical and should not block successful signup after invite redemption.
