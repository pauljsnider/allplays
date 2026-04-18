# Implementation Plan
- Update `tests/unit/parent-dashboard-calendar-day-modal-rsvp.test.js` to import `vi` from Vitest.
- Freeze system time to a point before the fixture event date, run the existing assertions unchanged, then restore real timers in `finally`.
- Avoid touching production files because the root cause is a date-sensitive test fixture.
