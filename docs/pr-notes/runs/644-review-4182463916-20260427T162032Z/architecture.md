# Architecture Review

## Decision
Use a minimal client-state preservation patch in `edit-team.html`. The bug is transient DOM state loss during preview rerender, not a backend access-model issue.

## Design
- Track the last rendered rollover source team ID.
- Before rebuilding the preview, capture current carry-over enabled state and checked staff emails from the DOM.
- If the same source team is still selected, render from the captured state.
- If the source team changed, reset to the existing default: enabled and all eligible staff checked.
- Keep Firestore schema, rules, and `js/rollover-access.js` unchanged.

## Risk And Rollback
- Reduces team-level privilege expansion risk from accidental re-selection.
- Rollback is a simple revert of the `edit-team.html` and unit-test changes.
- No data migration required. If bad data was already written, remove unintended emails from the affected team `adminEmails` array.
