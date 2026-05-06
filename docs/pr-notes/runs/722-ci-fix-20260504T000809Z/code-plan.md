# Code Plan

## Target File
- `tests/smoke/edit-roster-bulk-ai-reset.spec.js`

## Minimal Patch
Add no-op exports to `DB_STUB` for the newly imported roster field definition functions:
- `saveRosterFieldDefinition`
- `disableRosterFieldDefinition`
- `reorderRosterFieldDefinitions`

## Why This Fix
The application page imports these functions at module load time. Playwright route stubs must provide the same named exports or the page script aborts before Bulk AI event handlers are registered.

## Non-Goals
- No production code changes.
- No changes to Bulk AI behavior or roster field definition behavior.
