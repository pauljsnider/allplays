## Code Role

Planned patch:
- Add `refreshScheduleAfterCsvImport()` near the CSV preview/import helpers.
- Replace direct `loadSchedule()` calls in the import completion paths with the helper.
- Append refresh warnings to existing partial-success and completion messaging.
- Add a source-level unit test for the wiring in `edit-schedule.html`.

Implementation notes:
- Keep the row-by-row persistence contract unchanged.
- Do not change notification follow-up behavior.
- Keep retry limited to rows that actually failed validation or persistence.
