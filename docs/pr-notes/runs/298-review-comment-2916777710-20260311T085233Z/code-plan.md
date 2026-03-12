## Code role summary

1. Replace stale `utils.js` import tokens on every page that imports `getCalendarEventTrackingId` or `isTrackedCalendarEvent`.
2. Standardize those imports on `v=10`, because `master` already established `v=10` as the latest safe token for `utils.js`.
3. Extend `tests/unit/ics-tracking-ids.test.js` to assert the four impacted pages keep the `v=10` token.
