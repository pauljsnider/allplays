# Code Plan

- Update `tests/smoke/team-schedule-calendar.spec.js` so the DB module route matches any `v=` cache-bust query rather than the stale `v=15` value.
- Do not modify production page behavior.
- Run the targeted smoke spec and commit only the smoke harness change plus required run notes.
