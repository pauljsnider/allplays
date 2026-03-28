Coverage target:
- Grouped calendar/day-modal RSVP buttons with `data-child-ids`.
- Per-child list card RSVP buttons with `data-child-id`.

Test plan:
1. Behavioral Vitest case for grouped row:
   - click path resolves selected row child IDs only
   - multi-child submit uses `submitRsvp`
   - only that game's rows update local `myRsvp` and `rsvpSummary`
2. Behavioral Vitest case for per-child card:
   - single-child submit uses `submitRsvpForPlayer`
   - sibling card for same game stays unchanged
   - unrelated game stays unchanged
3. Wiring assertions:
   - `parent-dashboard.html` imports the RSVP controller helper
   - grouped buttons keep `data-child-ids`
   - child cards keep `data-child-id`

Validation:
- Run the new focused Vitest file.
- Run the adjacent existing RSVP unit file to guard helper compatibility.

Residual risk:
- No full browser execution for this flow in the current environment/tooling.
- Rendering remains covered by source wiring assertions plus state-mutation behavior, not DOM screenshots.
