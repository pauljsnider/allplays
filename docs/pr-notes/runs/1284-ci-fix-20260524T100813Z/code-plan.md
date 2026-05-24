# Code Plan

## Root Cause
`game-plan-switching.test.js` extracts `loadGame` from `game-plan.html` and executes it in a synthetic `new Function` scope. PR code added a call to imported helper `normalizeLineupsForGamePlanPlanner`, but the test harness did not provide that symbol.

## Implementation Plan
- Import `normalizeLineupsForGamePlanPlanner` in the test file.
- Add it to the harness dependency object.
- Bind it inside the synthetic function before evaluating `loadGame`.

## Scope
Only the failing unit test harness changes. No production behavior changes.
