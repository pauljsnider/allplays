# QA notes

## QA Plan
- Run targeted smoke specs that failed in preview-smoke.
- Run the cancellation unit test for helper-level cancellation detection.

## Negative Coverage
- Tracked calendar imports stay suppressed.
- Time-conflicting calendar imports stay suppressed.
- Cancelled imports are absent from default upcoming filters.
- Past cancelled rows still show cancellation styling and hide Track / Plan Practice actions.
