# Code plan

## Implementation Plan
- Update `tests/unit/live-tracker-save-complete.test.js` so the stored finalization replay assertion expects the current event-write then aggregated-stats write order.
- Do not change `js/live-tracker-save-complete.js`; batch splitting/order is already validated by `tests/unit/live-tracker-finish-batch-limit.test.js`.

## Minimality
- Scope is one assertion reorder in the failing unit test plus required PR notes.
