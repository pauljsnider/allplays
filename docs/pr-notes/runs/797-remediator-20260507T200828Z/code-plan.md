## Code Plan

1. Add `MAX_ORGANIZATION_SCHEDULE_CSV_IMPORT_ROWS = 500` near CSV import state.
2. In the CSV file change handler, after parsing the file and before building/rendering preview rows, reject `parsed.rows.length > 500` with a clear error, clear preview UI, and disable import.
3. In the import button click handler, before iterating `preview.validRows`, reject `preview.validRows.length > 500` with the same clear error and return before writes.
4. Keep patch scoped to `organization-schedule.html` and add/update tests only if an existing targeted test harness is present.

## Candidate Commit Message

Add organization CSV import row limit
