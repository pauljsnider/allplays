Test strategy:
- Extend the focused cancel-game regression test to assert that `edit-schedule.html` awaits `loadSchedule()` after a successful cancellation.
- Re-run the existing cancel-game unit tests and the related schedule cancellation test file.

Primary regression risks:
- Reintroducing a stale schedule view after a successful cancellation.
- Accidentally turning a partial-success warning back into a fatal error.

Validation targets:
- `tests/unit/edit-schedule-cancel-game.test.js`
- `tests/unit/edit-schedule-calendar-cancellation.test.js`

Manual spot check if needed:
1. Cancel a scheduled game.
2. Force `postChatMessage(...)` to fail after `cancelGame(...)` succeeds.
3. Confirm the schedule shows the cancelled state before the warning is shown.
