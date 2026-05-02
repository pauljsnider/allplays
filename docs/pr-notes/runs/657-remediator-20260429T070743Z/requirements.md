# Requirements

## Acceptance Criteria
- Re-importing a registration schedule row whose start timestamp is provided in `startsAt` must match an existing local event with the same timestamp and title/opponent.
- Matching must continue to support existing source fields: `date`, `start`, and `startTime`.
- Conflict behavior remains unchanged: a same local event without external metadata is reported as a conflict, not added as a duplicate.
- No unrelated import behavior changes.

## Constraints
- Static JavaScript app, no automated test runner required by repo guidance.
- Keep the change scoped to `js/edit-schedule-registration-import.js`.
