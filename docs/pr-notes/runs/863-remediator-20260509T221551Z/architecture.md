# Architecture Notes

- Keep the change local to `isExcludedHomepageUpcomingStatus` in `js/db.js`.
- Normalize only string statuses with `trim().toLowerCase()` to preserve string behavior and avoid invoking string methods on legacy numeric/object values.
- Return `false` for non-string values so malformed status fields do not crash homepage upcoming-game discovery.
