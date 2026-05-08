## Acceptance Criteria

1. CSV schedule bulk import must reject imports with more than 500 valid rows before creating any games.
2. When the valid row count exceeds 500, the admin sees a clear, actionable error explaining the 500-row limit and that the CSV should be split into smaller files.
3. The import action must not partially process oversized files.
4. The existing preview flow may display parsed results, but the final import must enforce the 500-row cap using `preview.validRows.length`.
5. Imports with 500 or fewer valid rows continue to work as they do today.
6. Empty, invalid-only, or mixed-validity files continue to show existing validation feedback without regression.
7. The UI must keep the admin oriented during failure: no spinner left active, import controls return to a usable state, and the failed import is clearly distinguishable from a successful one.
8. Manual verification must cover: 499 rows, 500 rows, 501 rows, invalid rows mixed with valid rows, and retrying after an oversized file failure.
