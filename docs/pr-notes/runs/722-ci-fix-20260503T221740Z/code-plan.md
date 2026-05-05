# Code Plan

## Acceptance criteria
- Bulk AI smoke tests load `edit-roster.html` without module import failures.
- Image upload preview handler is registered and makes `#roster-image-preview` visible.
- Cancel/reset assertions continue to verify stale image state is cleared.

## Implementation plan
- Add no-op exports for `saveRosterFieldDefinition`, `disableRosterFieldDefinition`, and `reorderRosterFieldDefinitions` to the `DB_STUB` in `tests/smoke/edit-roster-bulk-ai-reset.spec.js`.
- Do not change runtime code.

## Validation
- `npx playwright test -c playwright.smoke.config.js tests/smoke/edit-roster-bulk-ai-reset.spec.js --reporter=line`

## Rollback
- Revert the smoke test stub additions.
