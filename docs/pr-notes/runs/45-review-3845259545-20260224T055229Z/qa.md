# QA Role Notes

## Regression Risks
- False negatives in reconciliation (legit correction not applied).
- False positives causing score overwrite in resumed sessions.

## Coverage Added
- Unit tests for trust predicate:
  - trusted when derived score matches live score and scoring events exist
  - untrusted when live score exceeds derived log total (partial log)
  - untrusted when no scoring events exist

## Manual Checks Suggested
- Resume existing game with non-zero saved score, add a new bucket, finish, verify final score is preserved.
- Fresh game with full in-session logging, manually alter final inputs before finish, verify reconciliation corrects to event totals.
