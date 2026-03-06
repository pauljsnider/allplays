# Code Role (manual fallback)

## Patch plan
1. Add failing unit tests for weekly interval handling in recurrence expansion.
2. Update weekly recurrence matching in `js/utils.js` to enforce interval.
3. Re-run targeted and full unit tests.
4. Commit with issue reference.

## Non-goals
- No refactor of recurrence model.
- No UI changes in `edit-schedule.html`.
