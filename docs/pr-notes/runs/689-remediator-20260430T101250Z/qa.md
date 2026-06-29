# QA Notes

## QA Plan
- Static inspection: confirm `team.html` imports `./js/db.js?v=76` for `saveTeamAvailabilityPreferences`.
- Static inspection: confirm `game-day.html` imports `./js/db.js?v=76` and passes `skipAvailabilityCutoff: true` only through the coach override wrapper.
- Unit validation: run targeted Game Day RSVP controller tests to ensure coach controls still call the injected RSVP function and update UI state.
- Broader validation: run unit tests for RSVP-related pages if time permits.

## Notes
- The role subagent run did not complete cleanly, so these notes are the inline fallback analysis required by the remediator workflow.
