Objective: resolve the two unresolved PR #298 review comments without broadening the change set.

Current state:
- `edit-schedule.html` imports new named exports from `js/utils.js?v=8`.
- `parent-dashboard.html` uses occurrence ids for recurring ICS events when reading and writing rideshare offers.

Required state:
- Any page importing the new `utils.js` exports must use a bumped cache-busting token.
- Parent dashboard rideshare must keep legacy UID-keyed recurring ICS offers visible and actionable after deploy.

Assumptions:
- Existing legacy rideshare data lives under `teams/{teamId}/games/{calendarUid}/rideOffers`.
- A fallback is acceptable in place of a Firestore migration for this PR.

Success criteria:
- New HTML cannot load against an older cached `utils.js` module for these imports.
- Recurring ICS practices with preexisting UID-keyed rideshare offers still show offers and support request/update actions.
