Implementation plan:
1. Add `tests/smoke/edit-schedule-calendar-import.spec.js` with a local static server and route-based module stubs.
2. Prove failure against current code by asserting imported practice planning preserves duration.
3. Patch `js/edit-schedule-calendar-import.js` to carry imported `dtend` into merged rows.
4. Re-run the focused browser test and existing helper unit test.
5. Commit test plus fix together.
