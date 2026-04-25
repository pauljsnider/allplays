# Code Plan

## Likely Fault Location
`edit-schedule.html` `maybeNotifyScheduleChange` loop over `postChatMessage` targets.

## Minimal Patch Plan
- Add a shared helper in `js/schedule-notifications.js` that posts to all targets and records successes/failures.
- Reuse that helper in `maybeNotifyScheduleChange` and `cancelScheduledGame`.
- Treat partial success as sent, and throw only when every target fails.

## Test Updates
- Add unit coverage for partial success and all-fail cases in `tests/unit/schedule-notifications.test.js`.
- Update wiring tests for new helper imports and cache-busted module versions.

## Validation Commands
- `npx vitest run tests/unit/schedule-notifications.test.js tests/unit/edit-schedule-notifications.test.js tests/unit/edit-schedule-cancel-game.test.js`
- `git diff --stat`
