# Architecture Notes

## Architecture Decisions
- Use a fresh `db.js` query token (`v=17`) on pages that need the changed `db.js` behavior or export surface.
- Keep `submitRsvp` and default `submitRsvpForPlayer` behavior gated by `assertAvailabilityOpen`.
- Add an explicit `skipAvailabilityCutoff` option to `submitRsvpForPlayer`, defaulting to `false`, and use it only from the Game Day coach override wiring.
- Do not refactor Firestore write paths or summary aggregation.

## Risks And Rollback
- Risk: client-side cutoff gating is not a security boundary. Firestore rules remain the actual write control.
- Rollback: revert the wrapper and cache-bust changes; parent RSVP cutoff behavior would remain unchanged.

## Notes
- The role subagent run did not complete cleanly, so these notes are the inline fallback analysis required by the remediator workflow.
