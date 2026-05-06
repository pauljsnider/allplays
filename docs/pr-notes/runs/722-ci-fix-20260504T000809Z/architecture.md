# Architecture Note

## Acceptance Criteria
- `edit-roster-bulk-ai-reset` smoke tests boot `edit-roster.html` without module import failures.
- Bulk AI image upload preview handler is attached before the test uploads a file.
- No production behavior changes unless required by the failure.

## Root Cause
`edit-roster.html` now imports additional roster field definition functions from `js/db.js` (`saveRosterFieldDefinition`, `disableRosterFieldDefinition`, `reorderRosterFieldDefinitions`). The smoke test replaces `js/db.js` with a local module stub, but the stub did not export the new functions. Browser module evaluation failed before page scripts registered the Bulk AI image change handler, leaving `#roster-image-preview` hidden.

## Decision
Patch the smoke test dependency stub to match the production module export surface used by `edit-roster.html`. This is a test-drift fix, not an application logic change.

## Risks And Rollback
- Risk: none to production runtime because only a smoke test stub changes.
- Rollback: revert the test stub additions if the page stops importing these functions.
