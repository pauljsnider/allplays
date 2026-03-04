# Code role (fallback synthesis)

## Plan
1. Add failing tests in `tests/unit/parent-dashboard-rsvp.test.js` for per-child RSVP hydration mapping.
2. Implement helper(s) in `js/parent-dashboard-rsvp.js` to map current parent's RSVPs by child/player.
3. Update `parent-dashboard.html`:
   - import `submitRsvpForPlayer` and `getRsvps`
   - submit child-scoped RSVP through `submitRsvpForPlayer` when one player is selected
   - hydrate `myRsvp` per child row using RSVP docs map
4. Run targeted vitest file(s).
5. Commit with issue reference.

## Assumptions
- Parent dashboard child cards submit exactly one player ID per click.
- Firestore rules already allow `uid__playerId` doc IDs for parent/team users.
