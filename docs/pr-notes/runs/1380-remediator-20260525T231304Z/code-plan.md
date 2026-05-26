# Code Plan

Implementation plan:
1. Update `tests/unit/calendar-day-modal-rsvp.test.js` to replace the schedule-print import via regex matching `?v=<number>`.
2. Update `formatDateInput` in `js/schedule-print.js` to format from local date parts.
3. Add a unit test for UTC+ local-midnight default print dates in `tests/unit/team-schedule-filter.test.js`.
4. Run targeted Vitest files, then commit.
