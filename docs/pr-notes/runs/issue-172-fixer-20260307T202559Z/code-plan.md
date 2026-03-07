Implementation plan:
1. Extend `tests/unit/calendar-ics-event-type.test.js` with missed cancelled variants.
2. Add `tests/unit/edit-schedule-calendar-cancellation.test.js` to lock `edit-schedule.html` onto shared cancellation logic.
3. Update `edit-schedule.html` to import and use `getCalendarEventStatus`.
4. Normalize cancelled summary prefix cleanup for both spellings.
5. Run targeted Vitest commands, then commit with issue reference.
