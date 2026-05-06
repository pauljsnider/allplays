# QA Notes

## Validation Plan
- Run the affected Playwright smoke specs:
  - `npx playwright test tests/smoke/edit-schedule-calendar-import.spec.js tests/smoke/edit-schedule-calendar-cancelled-import.spec.js`

## Failure Hypothesis
- Missing DB stub export prevents module boot, leaving `#schedule-list` empty and preventing add/update calls from being recorded.

## Regression Coverage
- The affected specs cover imported practice rows, cancelled import visibility/action suppression, saved season field hydration, and new league game season record opt-in.
