Objective: stop `calendar.html` from submitting parent RSVPs for unrelated linked players on the same team.

Current state:
- Calendar RSVP buttons only carry `teamId` and `gameId`.
- Submission resolves `playerIds` from a team-level parent link map, so one click can update multiple children unintentionally.

Proposed state:
- Calendar RSVP buttons carry the clicked event's `childId` and/or aggregated `childIds`.
- Submission resolves `playerIds` from the selected event scope first and only uses event-attached child scope.

Risk surface and blast radius:
- Affects parent RSVP writes for tracked DB games/practices on `calendar.html`.
- No change to coach flows, Firestore schema, or non-calendar RSVP entry points.

Assumptions:
- Event rows can safely carry `childId`/`childIds` metadata without changing visible behavior.
- Existing shared helper logic in `js/parent-dashboard-rsvp.js` is the intended scoping source of truth.

Recommendation:
- Reuse the existing RSVP scope resolver instead of inventing calendar-only logic.
- Add regression coverage for aggregated `childIds` event scope so future UI paths keep the same contract.
