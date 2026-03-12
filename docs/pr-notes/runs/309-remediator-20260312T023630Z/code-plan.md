Implementation plan:
- Update the `.cancel-game-btn` handler in `edit-schedule.html`.
- When `result.cancelled` is true, preserve `result.notificationError` independently of the refresh.
- Run `loadSchedule()` in a guarded block so refresh errors do not prevent the partial-success alert.
- Keep the non-cancelled error path unchanged.
