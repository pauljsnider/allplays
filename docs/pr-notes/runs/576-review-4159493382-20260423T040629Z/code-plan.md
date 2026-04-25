# Implementation Plan

## Chosen Direction
- Treat the review as already fixed in production code at branch head `1e2ef17`.
- Add the missing Team ID panel elements to `tests/unit/edit-team-admin-access-persistence.test.js` so regression tests reflect the live page.

## Patch Scope
- `tests/unit/edit-team-admin-access-persistence.test.js`
  - Add `team-id-panel`
  - Add `team-id-text`
  - Add `team-id-status`
  - Add `copy-team-id-btn`

## Validation
- Run the targeted edit-team unit test.
- Run the full unit suite.
- Commit only the test-harness change and push to the PR branch.

## Risks And Rollback
- Low blast radius, test-only.
- Revert the commit if CI or review finds unexpected harness coupling.

## Orchestration Note
- Required subagent spawn was attempted from the main run, but the local gateway timed out before child sessions became usable. This artifact records the implementation view for traceability.
