Regression target:
- Coach/admin schedule import path on `edit-schedule.html`.

Tests to add:
1. Validate `.ics` URL acceptance and rejection through the shared helper used by the add-calendar save path.
2. Verify imported calendar events merge into schedule candidates with correct `game` vs `practice` typing.
3. Verify duplicate suppression skips:
   - already tracked calendar occurrences
   - imported events whose timestamp conflicts with an existing DB event
4. Verify `edit-schedule.html` uses the helper and still exposes `Track` for games and `Plan Practice` for practices.

Residual risk:
- This remains unit-level coverage, so DOM wiring is protected by source assertions rather than a full browser run.
- Real fetch/parsing integration still depends on `fetchAndParseCalendar()` coverage elsewhere.

Validation plan:
- Run the new calendar-import unit test file.
- Run the existing ICS tracking and related edit-schedule unit tests to catch adjacent regressions.
