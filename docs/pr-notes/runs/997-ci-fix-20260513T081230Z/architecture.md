# Architecture Notes

Subagent spawn was unavailable in this environment, so architecture analysis was completed inline.

## Root Cause
`game.html` centralizes postgame summary Save button state through `syncSaveButtonState()`, which only assigns `saveBtn.disabled = isSavingSummary`. The regression test `tests/unit/postgame-summary-editor.test.js` asserts that opening and closing the summary editor explicitly re-enable Save Summary, then saving disables it, then failure recovery re-enables it. The behavior exists indirectly, but the static guard expects explicit state transitions inside the relevant control flow.

## Decision
Keep the existing static HTML/vanilla JS structure and make a minimal targeted change inside `setupSummaryControls()` only. No Firebase, data model, or access-control changes.

## Risks and Rollback
Risk is limited to the postgame summary editor button state. Rollback is reverting the small `game.html` state-management change.
