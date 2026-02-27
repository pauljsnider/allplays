# Requirements role output

## Objective
Ensure parent invite signup is atomic: if invite redemption fails, account creation must fail visibly and no success redirect path should execute.

## Current vs proposed
- Current: parent invite redemption errors are caught and suppressed in auth flows; signup appears successful and user lands in default dashboard without parent linkage.
- Proposed: parent invite redemption failure throws a user-facing error, aborts signup completion, and rolls back the just-created auth user where possible.

## Constraints
- Keep change narrowly scoped to parent invite onboarding paths.
- Preserve coach/admin activation code signup behavior.
- Add regression unit coverage for failure and rollback behavior.

## Success criteria
- Parent invite redemption failure does not resolve signup as success.
- User sees clear actionable error message.
- No stranded newly-created auth user remains from failed parent invite onboarding.
