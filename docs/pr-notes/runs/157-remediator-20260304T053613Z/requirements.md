# Requirements Role Notes

## Objective
Resolve PR feedback thread PRRT_kwDOQe-T585x-W_e by preventing rideshare data collisions for recurring ICS practices.

## Evidence
- `parent-dashboard.html` currently allows rideshare when `event.isDbGame || event.type === 'practice'`.
- ICS events are mapped with `id: event.uid`.
- Recurring ICS expansion keeps the same UID across occurrences, so multiple dates share one rideshare path key.

## Required Behavior
- Rideshare must only be enabled for events with stable per-instance IDs that map to distinct `teams/{teamId}/games/{id}` documents.
- Non-DB calendar practices (and other non-DB events) should not show rideshare controls.
