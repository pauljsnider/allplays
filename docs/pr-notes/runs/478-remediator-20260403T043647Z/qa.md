Validation target:
- `tests/smoke/edit-schedule-calendar-cancelled-import.spec.js`

Checks:
- Confirm `extractOpponent` removes `[CANCELED]` prefixes and strips `<team> vs.` using valid runtime escaping.
- Confirm `getCalendarEventStatus` detects bracketed cancelled markers with a valid regex literal.
- Run a targeted syntax check over the spec file. Run a targeted Playwright invocation if repo dependencies are present and inexpensive.

Success criteria:
- The over-escaped regex sequences are removed.
- No syntax errors in the edited spec file.
