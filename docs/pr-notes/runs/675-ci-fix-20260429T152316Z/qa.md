# QA Notes

## Failure Covered
- `preview-smoke [preview-smoke]` failed because imported calendar rows were not present in `#schedule-list` before the assertion timeout.

## Validation Plan
1. Run the targeted smoke specs for edit schedule calendar import and cancelled import.
2. Run the full preview smoke suite with `SMOKE_SUITE=preview` to catch ordering and bootstrap regressions.

## Expected Results
- Imported practice rows show Calendar, Practice, title, location, and Plan Practice.
- Cancelled imports stay visible and do not show Track or Plan Practice actions.
- Tracked and conflicting imports remain suppressed.
