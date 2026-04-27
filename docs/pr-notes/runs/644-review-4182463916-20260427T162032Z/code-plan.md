# Code Plan

## Implementation
- Add `lastRenderedRolloverSourceTeamId` page state.
- Capture current rollover enabled state and checked rollover staff before rerender.
- Preserve those values when rerendering the same source team.
- Reset to default checked state only when the selected source team changes.
- Extend the edit-team DOM test harness to parse rollover staff checkboxes.
- Add unit coverage for disabled rollover and individual deselection persistence.

## Files
- `edit-team.html`
- `tests/unit/edit-team-admin-access-persistence.test.js`
