# Code role notes

1. Patch `js/schedule-csv-import.js` so time-only end and arrival mappings can borrow the date from the mapped combined start datetime.
2. Refactor the CSV preview renderer in `edit-schedule.html` to support row-status updates without rerendering the full list on every keystroke.
3. Make `persistCsvImportRow` return non-fatal warnings for post-create notification/update failures.
4. Change the import button flow to continue after row failures, retain only failed rows for retry, reload the schedule after any successful imports, and show a partial-success message.
5. Run targeted smoke validation, then commit the scoped changes.
