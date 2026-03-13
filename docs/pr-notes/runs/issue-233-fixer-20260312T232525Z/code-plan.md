# Code Role (allplays-code-expert)

## Plan
1. Update calendar cancellation regression tests in `tests/unit/calendar-ics-event-type.test.js` and `tests/unit/calendar-page-cancellation.test.js`.
2. Add a small shared helper in `js/utils.js` to strip cancelled summary prefixes before display while keeping cancellation status.
3. Add a compact-view cancelled badge in `calendar.html` and bump the `utils.js` import version.
4. Run targeted tests, then the full unit suite, and commit with issue reference.

## Non-Goals
- No change to ICS parsing, Firestore data, or recurrence logic.
- No unrelated calendar layout refactor.
