Implementation plan:
1. Edit `tests/smoke/edit-schedule-calendar-cancelled-import.spec.js`.
2. In `UTILS_STUB.extractOpponent`, reduce escaping so the regex literal and constructor string compile to the intended patterns.
3. In `UTILS_STUB.getCalendarEventStatus`, reduce escaping in the bracket-matching regex literal.
4. Run a targeted validation command for the edited spec.
5. Stage the updated spec and note files, then commit with a short imperative message.
