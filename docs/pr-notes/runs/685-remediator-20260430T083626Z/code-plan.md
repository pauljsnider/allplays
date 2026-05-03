# Code Plan

## Review Outcome
No minimal source-code change is required. PR #685 already implements local attraction sponsors with:

- Firestore rules for `teams/{teamId}/sponsors`.
- `getLocalAttractionSponsors(teamId)` in `js/db.js`.
- Normalization and safe URL helpers in `js/local-attractions.js`.
- Team page rendering in `team.html`.
- Unit coverage in `tests/unit/local-attractions.test.js`.

## Implementation Plan
- Do not change functional source files because the review feedback contains no blocking or requested code changes.
- Persist the required role-analysis notes under `docs/pr-notes/runs/685-remediator-20260430T083626Z/`.
- Run the targeted Vitest test for the affected helper.
- Commit the notes only.

## Residual Risks
Manual browser validation is still recommended for real Firestore permission behavior and sponsor card rendering. Admin sponsor creation or data seeding remains out of scope for this PR.
