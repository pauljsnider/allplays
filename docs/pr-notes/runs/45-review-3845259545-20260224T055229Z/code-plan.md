# Code Role Notes

## Patch Scope
- `js/live-tracker-integrity.js`
  - Added `canTrustScoreLogForFinalization`.
- `js/live-tracker.js`
  - Guarded final-score reconciliation behind trust predicate.
- `js/track-basketball.js`
  - Guarded final-score reconciliation behind trust predicate.
- `tests/unit/live-tracker-integrity.test.js`
  - Added predicate unit tests.

## Rationale
This is the smallest safe patch that removes destructive overwrite behavior without changing persistence model or requiring event-log rehydration.
