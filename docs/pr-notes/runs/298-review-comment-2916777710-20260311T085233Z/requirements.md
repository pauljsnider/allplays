## Requirements role summary

- Objective: prevent module-load failures after deploy by ensuring every page that imports the new calendar tracking helpers requests a fresh `utils.js` asset.
- Current state: `edit-schedule.html`, `parent-dashboard.html`, `game-plan.html`, and `team.html` import `getCalendarEventTrackingId` and/or `isTrackedCalendarEvent`; some still referenced stale cache tokens and `v=9` is also unsafe because `master` already served an older `utils.js?v=9`.
- Proposed state: all pages importing the new helpers use `./js/utils.js?v=10`, matching the current cache-busted `utils` line already used on `calendar.html`.
- Risk surface: static-site asset caching only. Blast radius is limited to pages importing the new helpers, but failure mode is hard page break on module parse/load.
- Acceptance criteria:
  - Every page importing `getCalendarEventTrackingId` or `isTrackedCalendarEvent` references `./js/utils.js?v=10`.
  - Focused regression coverage asserts those import tokens remain aligned.
