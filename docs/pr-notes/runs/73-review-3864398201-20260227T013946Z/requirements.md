# Requirements Role Notes

## Objective
Close Codex inline review issues on PR #73 without widening blast radius for signup flows.

## User-facing constraints
- Parent invite signup must fail closed.
- Failed profile write must not permanently consume invite code.
- Google redirect signup must not retain stale `pendingActivationCode` values.

## Acceptance criteria
- If invite redemption fails before side effects, auth user rollback still runs.
- If invite redemption succeeds and rollback fails, auth user is retained to preserve recoverability.
- If new-user Google auth setup throws at any point, `pendingActivationCode` is removed from `sessionStorage`.
- Unit tests cover both rollback-success and rollback-failure branches.
