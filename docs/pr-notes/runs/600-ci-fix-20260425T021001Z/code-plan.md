# Implementation Plan
- Keep the fix scoped to `tests/smoke/team-schedule-calendar.spec.js`.
- Add a small parser for `#schedule-calendar-month-label` so the smoke helper can determine the currently visible month.
- Change `gotoCalendarMonth` to loop based on the rendered month label and click prev/next until the target month is visible, then stop.

# Validation
- Start a local static server on port 4173.
- Run the single failing smoke test and require a clean pass before commit.
