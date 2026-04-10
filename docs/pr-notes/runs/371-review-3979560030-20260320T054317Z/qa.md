## QA role

- Verified review findings:
  - End/arrival fallback from combined start datetime is implemented in `js/schedule-csv-import.js`.
  - Mid-run import resilience is implemented in `edit-schedule.html` with per-row failure retention and warning handling.
- New regression found: wiring test asserts `?v=1` while source uses `?v=2`.
- Validation target after patch: grep confirmation of version alignment and clean git diff limited to the test plus run notes.
- Constraint: this runner lacks `npm` and repo-local `vitest`, so automated execution is blocked here.
