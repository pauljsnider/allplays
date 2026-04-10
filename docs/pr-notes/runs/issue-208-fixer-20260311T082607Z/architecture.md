# Architecture role

- Current state: `parseICS()` already expands recurring events and assigns occurrence ids, but downstream views and tracking persistence still key off the master `UID`.
- Proposed state: use occurrence-specific ids (`event.id`) as the canonical tracking key for recurring ICS instances, with `uid` only as a fallback for non-recurring events.
- Blast radius:
  - low to moderate, limited to ICS display and tracked-calendar de-duplication paths
  - no Firestore schema change; existing `calendarEventUid` field stores a more specific value for new tracked recurring imports
- Compatibility:
  - retain `uid` fallback for single events
  - add same-minute DB conflict suppression in the shared calendar to avoid duplicate legacy tracked occurrences

