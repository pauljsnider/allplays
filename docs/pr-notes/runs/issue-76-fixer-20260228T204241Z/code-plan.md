# Code Role Plan

## Implementation plan
1. Add failing unit tests in `tests/unit/ics-timezone-parse.test.js` covering TZID and numeric offset DTSTART values.
2. Update ICS parsing in `js/utils.js`:
   - capture DTSTART/DTEND field parameters
   - extend date parsing to support TZID and offsets
3. Run targeted unit tests, then broader unit test command if available.
4. Commit test + fix together referencing #76.

## Conflict resolution
Role recommendations are aligned on a parser-only targeted fix with tests; no conflicts requiring broader refactor.
