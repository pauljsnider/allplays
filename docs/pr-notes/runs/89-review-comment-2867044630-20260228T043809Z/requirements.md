# Requirements Role Summary

## Objective
Fix weekly recurrence interval bucketing so multi-day weekly schedules with `interval > 1` honor calendar week groupings, not start-date-offset 7-day chunks.

## User/UX Impact
- Coaches scheduling biweekly practices on multiple weekdays should see expected dates.
- Parents/players should not miss valid sessions due to hidden scheduling gaps.

## Acceptance Criteria
1. For weekly recurrences with `byDays` and `interval > 1`, active/inactive week gates are computed from calendar week boundaries containing series start.
2. Existing weekly interval behavior for single-day schedules remains correct.
3. Daily recurrence interval behavior remains unchanged.
4. Regression test covers a series starting midweek (`WE`) with `byDays: ['MO', 'WE']`, `interval: 2`, and includes Monday/Wednesday in active biweekly blocks.

## Risks / Blast Radius
- Scope limited to recurrence expansion logic in `js/utils.js` and unit tests.
- No Firestore schema, auth, or data write path changes.
