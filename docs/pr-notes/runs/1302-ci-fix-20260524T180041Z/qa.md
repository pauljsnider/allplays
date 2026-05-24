# QA notes

## QA Plan
- Run targeted smoke specs that failed in preview-smoke.
- Run the cancellation unit test for helper-level cancellation detection.

## Negative Coverage
- Tracked calendar imports stay suppressed.
- Time-conflicting calendar imports stay suppressed.
- Cancelled imports are absent from default upcoming filters.
- Past cancelled rows still show cancellation styling and hide Track / Plan Practice actions.
- Cancelled rows should not expose tracker or practice plan actions in any visible rendering path.

## CI Context
- Failing preview-smoke tests asserted cancelled imported calendar rows remained visible while Track/Plan actions stayed hidden.
- Targeted validation covers the two affected smoke specs and the cancellation unit test.
