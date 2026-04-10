# QA role notes

- Target checks:
  - Preview a CSV with `Start Date & Time`, `End Time`, and `Arrival Time`, but no standalone `Date`, and confirm preview keeps end and arrival datetimes.
  - Edit a validation error field in the preview and confirm the caret/focus stays in the active field while validation text updates.
  - Import a mixed-success batch and confirm successful rows are saved, failed rows remain in preview with row-level errors, and the schedule reloads to show imported rows.
- Validation approach in this run:
  - Run a targeted Node smoke test against `js/schedule-csv-import.js`.
  - Run a syntax parse check on `edit-schedule.html`'s inline module script.
  - Manual browser validation remains recommended because this repo has no automated UI test harness.
