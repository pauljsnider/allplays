# Code Plan

## Acceptance Criteria
- `team-management-access-wiring.test.js` accepts the current `edit-team.html` import of `./js/team-access.js?v=2`.
- `edit-team-admin-access-persistence.test.js` strips all current `edit-team.html` import statements before constructing `AsyncFunction`.
- No production behavior changes.

## Implementation Plan
1. Update the edit-team wiring expectation from `team-access.js?v=1` to `team-access.js?v=2`.
2. Update the edit-team admin persistence test replacement for the `db.js` import to include `getAllUsers`.
3. Update the team-access replacement to include `normalizeTeamPermissions` and `?v=2`.
4. Run targeted and CI unit tests.

## Risks
Test-only patch. Main risk is future brittle import-string drift; keep scope narrow for this CI fix.
