Objective: stop the family calendar from overwriting sibling availability when a parent has multiple linked children on the same team.

Current state:
- `calendar.html` treats RSVP scope as team-wide for the signed-in parent.
- A click on any availability button submits every linked `playerId` for that team.

Proposed state:
- Family calendar RSVP must require explicit child scope when the parent has more than one linked child on the selected team.
- Single-child teams keep the existing one-click flow.

Risk surface and blast radius:
- Affects parent availability writes from `calendar.html` only.
- Firestore write paths stay inside the existing RSVP collections.
- Main regression risk is confusing the calendar flow for single-child families or breaking RSVP summary updates.

Assumptions:
- Shared family calendar events are still rendered once per team event, not once per child.
- `profile.parentOf` contains `teamId`, `playerId`, and usually `playerName`.
- `submitRsvpForPlayer(...)` is the supported path for sibling-specific parent responses.

Recommendation:
- Add explicit child selection in the calendar RSVP block only when a parent has multiple linked children on that team.
- Route those submits through per-player RSVP docs so one sibling response does not overwrite another.

Success measure:
- Parent can set different responses for same-team siblings from `calendar.html`.
- RSVP summaries reflect both sibling responses independently.
