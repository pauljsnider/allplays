# Code Role Plan

## Plan
1. Add failing unit tests in `tests/unit/ics-recurrence-parse.test.js` for RRULE expansion and EXDATE exclusion.
2. Extend `parseICS` in `js/utils.js` to parse recurrence fields and expand occurrences.
3. Run targeted vitest command for changed and adjacent parser tests.
4. Commit with issue reference.

## Implementation notes
- Clone base VEVENT fields for each emitted occurrence.
- Derive occurrence `dtend` by applying master duration if dtend exists.
- Keep master `uid`; do not alter existing consumer expectations.
