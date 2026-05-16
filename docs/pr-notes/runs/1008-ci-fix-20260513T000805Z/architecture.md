# Architecture Notes

Root cause is smoke-test fixture drift, not production schedule rendering. `team.html` now imports Stream & Score grant helpers plus player tracking and staff permission modules; the smoke spec route stubs did not provide those exports/modules, so browser module evaluation stopped before schedule rendering populated `#schedule-list`.

Minimal safe fix: update only `tests/smoke/team-schedule-calendar.spec.js` stubs to match the `team.html` import surface. No production code or data model behavior changes.
