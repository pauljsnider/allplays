# Requirements Role Summary

## Objective
Remove hardcoded service account identity from `fetchCalendarIcs` without changing API behavior for calendar fetch clients.

## Current vs Proposed
- Current: `functions/index.js` embeds `game-flow-c6311@appspot.gserviceaccount.com` in source.
- Proposed: identity selection comes from Firebase runtime config (`calendar.service_account`) or platform default identity when unset.

## Risk Surface / Blast Radius
- Affects only Cloud Function runtime options for `fetchCalendarIcs`.
- No client-side API contract changes.

## Assumptions
- Runtime defaults are acceptable when explicit service account config is absent.
- Deployment environments can supply `calendar.service_account` if custom identity is required.

## Recommendation
Use config-driven runtime options and remove hardcoded account string from source.

## Success Criteria
- No hardcoded service account email in function source.
- `fetchCalendarIcs` handler signature and response shape unchanged.
