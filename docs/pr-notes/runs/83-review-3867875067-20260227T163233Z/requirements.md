# Requirements Role Notes

## Objective
Address PR #83 review-summary follow-up by aligning `js/team-access.js` documentation with implemented authorization behavior.

## Current vs Proposed
- Current: JSDoc for `hasFullTeamAccess` says full access includes coach assignment.
- Proposed: JSDoc states only owner, team admin email, and platform admin grant full access.

## Risk / Blast Radius
- Blast radius is documentation-only in one module.
- No runtime behavior, auth logic, or Firestore policy changes.

## Assumptions
- Review note requests a follow-up docs correction only.
- Existing tests already cover stale `coachOf` denial behavior.

## Acceptance Criteria
- `js/team-access.js` JSDoc no longer claims `coachOf` grants full access.
- Existing unit tests remain green.
