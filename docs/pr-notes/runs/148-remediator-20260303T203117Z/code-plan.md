# Code role notes

## Planned edits
1. `calendar.html`
- Add normalized summary variable in ICS loop.
- Replace summary cancellation detection with case-insensitive prefix detection.

2. `tests/unit/calendar-ics-cancelled-status.test.js`
- Update regex expectation to match the new normalized-prefix cancellation expression and status mapping.

## Commit scope
Only files needed to satisfy unresolved review threads, plus required run-note artifacts.
