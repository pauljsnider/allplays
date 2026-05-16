# Code Plan

## Minimal Change
Update `setupSummaryControls()` in `game.html` so the Save Summary button uses explicit disabled state transitions in the editor open/close/save/failure paths. Keep behavior scoped to postgame summary editing and avoid unrelated refactors.

## Files
- `game.html`
