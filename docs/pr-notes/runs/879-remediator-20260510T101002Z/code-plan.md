# Code Plan

- Modify `js/parent-dashboard-rsvp-controls.js` only.
- Build an affected-player-id set from the resolved submission target.
- For each same team/game event, always apply returned/default `rsvpSummary` to all siblings; apply `myRsvp` only to events whose child/player id was part of the submitted RSVP.
- Validate with existing tests or syntax/import inspection where no test runner exists.
