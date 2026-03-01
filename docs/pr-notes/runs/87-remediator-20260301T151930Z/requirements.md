# Requirements Role Notes

## Objective
Resolve PR thread PRRT_kwDOQe-T585xS5tL by preventing repeated full roster/profile hydration work when loading many RSVP summaries for one team.

## Current State
`calendar.html` and `parent-dashboard.html` request RSVP summary per event key. Existing db-layer cache reduces some repeated reads but call sites still perform per-key summary fetches.

## Required Change
Provide a team-scoped batch summary API and migrate both pages to use one batch request per team for unsummarized keys while keeping behavior unchanged.

## Success Criteria
- No behavior regression in RSVP summary rendering.
- Team roster/profile hydration reused during page hydration.
- Change stays scoped to RSVP hydration paths.
