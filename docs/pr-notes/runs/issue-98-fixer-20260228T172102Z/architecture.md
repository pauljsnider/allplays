# Architecture Role (allplays-architecture-expert)

## Objective
Apply the smallest client-side change that preserves existing auth flow while eliminating false-success parent invite signup outcomes.

## Current vs Proposed Architecture
- Current path: `login.html` submit -> `signup()` -> parent branch catches `redeemParentInvite()` error and resolves -> page redirects.
- Proposed path: same flow, but `signup()` rethrows parent-branch linking errors so promise rejects and login page catch block displays error.

## Controls Equivalence/Improvement
- Improved integrity control: success path requires successful parent linkage.
- No relaxation of access controls or tenant boundaries.
- Auditability unchanged; existing console logging remains and error is propagated to UX.

## Blast Radius
- Low: localized to `js/auth.js` parent invite email signup branch and its unit tests.
- No schema/rules/backend changes.

## Rollback Plan
Revert the single auth behavior commit if unexpected regressions appear in parent invite signups.
