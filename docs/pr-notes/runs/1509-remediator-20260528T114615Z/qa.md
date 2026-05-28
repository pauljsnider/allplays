# QA Plan

- Run the focused Vitest file for schedule update push notification payloads.
- Run the full unit suite via `npm test` if practical on this branch.
- Regression checks: timezone-aware event includes localized date/time; no-timezone date changes omit a potentially wrong formatted time.
