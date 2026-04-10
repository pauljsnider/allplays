# Architecture Role Notes

## Current -> Proposed
- Current: page loops call `getRsvpSummary(teamId, gameId)` per key.
- Proposed: page loops group unsummarized game IDs by `teamId` and call `getRsvpSummaries(teamId, gameIds)` once per team.

## Risk Surface
- `js/db.js` RSVP API surface adds one function.
- `calendar.html` and `parent-dashboard.html` import/use new function.
- No data model, rule, or auth path changes.

## Blast Radius
Low: local hydration logic only.
