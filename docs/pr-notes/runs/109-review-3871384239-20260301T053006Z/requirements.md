# Requirements Role Notes

## Objective
Prevent orphaned Firebase Auth accounts when parent-invite signup fails after email/password account creation.

## User/UX Constraint
Parent signup must fail closed: no success redirect and no partially created identity.

## Acceptance Criteria
- If `redeemParentInvite` or parent-invite profile write fails, the newly created Auth user is deleted.
- User session is signed out after cleanup attempt.
- Original error is rethrown so caller sees failure.
- Existing non-parent signup behavior remains unchanged.

## Risk/Blast Radius
- Touches only parent-invite branch in `signup` flow.
- No data model or routing changes.
