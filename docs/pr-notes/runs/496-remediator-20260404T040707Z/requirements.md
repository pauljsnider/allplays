Objective: resolve PR thread PRRT_kwDOQe-T58540beW without broadening scope.

Current state:
- `toDate` returns `null` for falsy values.
- `mergeCalendarImportEvents` conflict detection still calls `dbDate.getTime()` unguarded.

Proposed state:
- Keep `toDate` behavior unchanged.
- Guard conflict detection so legacy or empty `dbEvents[].date` values are skipped safely.

Assumptions:
- The review thread is limited to this null-handling regression.
- No broader date parsing changes are required for PR #496.

Success:
- Missing or empty `dbEvent.date` does not throw.
- Valid conflicting events still suppress imported duplicates.
