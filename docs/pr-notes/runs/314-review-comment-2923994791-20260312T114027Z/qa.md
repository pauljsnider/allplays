## QA role

- Primary regression to guard: legacy-only persisted clock data should restore without requiring live events or `liveClock*` fields.
- Tests to run:
  - `tests/unit/live-tracker-resume.test.js`
- Specific checks:
  - legacy-only game doc path restores clock
  - `liveClockPeriod/liveClockMs` fallback still restores
  - default `Q1 / 0` behavior still holds with invalid data
