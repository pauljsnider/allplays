Objective: restore `calendar.html` RSVP submissions for coach and other unscoped event flows without reopening the parent multi-child regression fixed in PR #294.

Current state:
- Calendar RSVP buttons now route through the shared scoped resolver.
- Events that do not carry `childId` or `childIds` now fail with `Select a child in this game before submitting RSVP.`
- Prior behavior allowed those submissions, usually with team-linked fallback ids for parents or an empty `playerIds` array for coaches.

Proposed state:
- Scoped parent submissions still resolve against the selected event child scope.
- Unscoped calendar events fall back to the legacy calendar submit payload instead of blocking the write.

Acceptance Criteria:
1. Calendar RSVP submits scoped child ids when the selected event exposes `childId` or `childIds`.
2. Calendar RSVP preserves legacy fallback behavior when the selected event exposes no child scope metadata.
3. Parent dashboard RSVP behavior remains unchanged.

Risk surface and blast radius:
- Limited to calendar RSVP submission on DB-backed events.
- No Firestore schema change.
- No change to coach override RSVP documents or parent-dashboard rendering.

Assumptions:
- `submitRsvp(...)` accepts an empty `playerIds` array as a valid legacy coach/no-scope submission.
- Calendar should remain backward compatible for events that have not been hydrated with child scope data.
