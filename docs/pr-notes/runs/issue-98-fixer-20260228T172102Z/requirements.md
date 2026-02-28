# Requirements Role (allplays-requirements-expert)

## Objective
Ensure parent invite signup only reports success when invite linking actually succeeds and user onboarding state is valid.

## Current vs Proposed
- Current: Parent invite linking errors are caught and logged in `signup()`, then the flow continues and UI redirects to `verify-pending.html`.
- Proposed: Parent invite linking errors in `signup()` are surfaced by throwing, so login page submit handler stays in error state and does not navigate to success.

## Risk Surface and Blast Radius
- Surface: Email/password signup flow using parent invite activation codes.
- Current blast radius: False-success UX, potential deleted/missing account after rollback, blocked onboarding.
- Proposed blast radius: Signup fails visibly on stale invite; no false success redirect.

## Assumptions
- `redeemParentInvite()` is the source of truth for invite validity and may throw for stale team/player targets.
- Login page already shows thrown error messages and only redirects on resolved promise.

## Recommendation
Fail closed for parent invite linking in `signup()` by rethrowing caught errors and add a regression unit test asserting rejection on redeem failure.

## Success Criteria
- Parent invite redeem failure causes `signup()` rejection.
- Signup page does not proceed to success path when parent linking fails.
- Standard non-parent signup behavior remains unchanged.
