# QA role

- Regression to cover:
  - recurring ICS occurrences generate distinct tracking ids
  - tracked-event matching does not collapse later occurrences in the same series
  - global calendar view model uses occurrence ids for recurring items
  - tracking/import path persists occurrence ids instead of bare series `UID`
- Validation scope:
  - unit tests around `parseICS`, calendar tracking id helpers, and source-level assertions for the tracking write path
  - targeted Vitest run for ICS recurrence and fetch tests plus the new regression test

