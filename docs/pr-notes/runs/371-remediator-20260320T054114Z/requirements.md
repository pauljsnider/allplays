# Requirements role notes

- Objective: resolve the three open PR #371 review findings without broad refactoring.
- Current state:
  - CSV preview loses `endsAt` and `arrivalTime` when the file maps `Start Date & Time` plus time-only end or arrival columns.
  - Inline preview correction rerenders the full preview list on every `input`, replacing the active DOM node.
  - CSV import stops on first thrown row error and reports a generic failure even after earlier rows were already persisted.
- Proposed state:
  - End and arrival datetimes inherit the date portion from the combined start datetime when no standalone date column is mapped.
  - Preview field edits update row validation state without rebuilding the full preview on each keystroke.
  - Import processes every row, leaves failed rows visible for retry, and does not treat post-create notification follow-up failures as row creation failures.
- Assumptions:
  - Partial-success reporting satisfies the review concern without requiring cross-document rollback support.
  - Existing manual validation is acceptable because the repo has no automated test runner.
