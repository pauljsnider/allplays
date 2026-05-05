# Architecture notes

## Root cause
The preview smoke failure is fixture drift, not a production rendering bug. `team.html` imports `postChatMessage` from `js/db.js`, but the smoke test route stub for `js/db.js` in `tests/smoke/team-schedule-calendar.spec.js` did not export that symbol. Browser ES module linking aborts before page initialization, so `#team-header` and `#schedule-list` remain skeleton/whitespace content.

## Minimal fix
Add an inert `postChatMessage` export to the smoke DB stub. This preserves production behavior and restores the test module contract.

## Risk and rollback
Risk is limited to the smoke harness. Rollback is removing the added stub export if the production import surface changes again.
