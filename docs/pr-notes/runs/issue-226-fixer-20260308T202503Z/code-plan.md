Constraint: the requested orchestration skills and `sessions_spawn` tool are not available in this runtime, so this run uses a single-agent synthesis recorded in these notes.

Smallest viable patch:
1. Add a helper that groups linked children by team and resolves whether calendar submission is unambiguous.
2. Add focused Vitest coverage for that helper.
3. Update `calendar.html` imports and state to use linked child objects instead of a raw team-to-player-id set.
4. Render a child picker in RSVP blocks only for teams with multiple linked children.
5. Submit sibling-specific calendar responses via `submitRsvpForPlayer(...)`; leave single-child flow on `submitRsvp(...)`.
