# Requirements Notes

## Acceptance Criteria
- `team.html` must import `js/db.js` with a cache-bust token that has not already been used by cached deployed pages, so the new `saveTeamAvailabilityPreferences` export is available immediately after deploy.
- Parent self-service RSVP submissions remain subject to the availability cutoff.
- Game Day coach/admin per-player RSVP overrides remain writable after the cutoff so coaches can make late roster corrections.
- Changes stay scoped to the review feedback only.

## Notes
- The role subagent run did not complete cleanly, so these notes are the inline fallback analysis required by the remediator workflow.
