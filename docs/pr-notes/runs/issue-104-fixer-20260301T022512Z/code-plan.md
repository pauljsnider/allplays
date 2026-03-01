# Code Role - Issue #104

## Implementation Plan
1. Add `js/parent-dashboard-rsvp.js` exporting pure helper `resolveRsvpPlayerIdsForSubmission`.
2. Add `tests/unit/parent-dashboard-rsvp.test.js` with fail-first scenarios:
   - explicit child row only
   - fallback scopes to same game, not entire team
3. Update `parent-dashboard.html`:
   - import helper
   - change `submitGameRsvp` to accept child context and use helper
   - pass `data-child-id` or `data-child-ids` from RSVP buttons
   - include `childIds` aggregation in calendar entry dedupe
4. Run targeted vitest suite and confirm pass.

## Conflict Resolution Notes
- Requirements preference (per-child by default) and Architecture preference (minimal change) align via explicit child context.
- QA requested aggregate-row support retained; implemented via `data-child-ids` path.
