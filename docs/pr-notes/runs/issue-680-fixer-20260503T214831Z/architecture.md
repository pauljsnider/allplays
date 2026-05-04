# Architecture Role Artifact

## Decision
Keep this as a static HTML copy and visual grouping change in edit-schedule.html. Do not change Firebase writes, Firestore schema, Cloud Functions, or notification behavior.

## Implementation Constraints
- Preserve DOM IDs used by existing JavaScript:
  - team-reminder-enabled
  - team-reminder-hours
  - save-team-reminder-settings-btn
  - game-notify-team
  - game-notify-note
  - practice-notify-team
  - practice-notify-note
- Separate concepts visually:
  - stored/future reminder timing defaults
  - immediate team chat notification controls

## Data and Security Impact
- No Firestore schema change.
- No permission change.
- No change to scheduleNotifications metadata persistence.
- No change to chat posting permissions or behavior.
