Decision: keep the fix local to `calendar.html` and a small helper module instead of changing RSVP storage semantics globally.

Why:
- `parent-dashboard.html` already uses child-scoped RSVP logic for ambiguous family contexts.
- `js/db.js` already supports sibling-safe writes through `submitRsvpForPlayer(...)`.
- The bug is in calendar-side request construction, not in summary computation.

Implementation shape:
- Add `js/calendar-rsvp.js` to normalize linked children by team and resolve the allowed submission mode.
- `calendar.html` renders a child picker in RSVP blocks when multiple linked children exist for the event team.
- If only one linked child exists, keep the existing `submitRsvp(...)` path.
- If multiple linked children exist, require a selected child and use `submitRsvpForPlayer(...)`.

Blast radius comparison:
- Current state silently overwrites sibling intent across the same team.
- New state narrows writes to the selected player when ambiguity exists, which reduces write blast radius from team-wide sibling scope to one child.

Rollback:
- Revert `calendar.html`, `js/calendar-rsvp.js`, and its unit test.
