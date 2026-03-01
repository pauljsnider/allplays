# Requirements Role Notes

## Objective
Prevent final-score data loss when a tracker session is resumed and `state.log` only contains a partial in-memory subset of scoring events.

## User/Coach Risk
- Coach resumes a game with existing points already persisted.
- New session starts with empty in-memory log.
- Finish flow incorrectly overwrites correct score with 0 or lower value derived from partial log.

## Decision
Only auto-reconcile final score from log when log is provably authoritative for current live score.

## Acceptance Criteria
- Finish flow keeps requested/live score when log does not represent total scoring.
- Finish flow still corrects manual final-score typos when log is complete for current game state.
- Behavior is consistent in both `live-tracker.js` and `track-basketball.js`.
