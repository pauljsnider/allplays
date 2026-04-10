Objective: Clear PR #432 CI with the smallest safe change.

Current state: `js/game-day-rsvp-controls.js` assumes `loadRsvps()` must return a truthy success flag and does not guarantee a re-render after state refresh. `game-day.html` still imports `js/db.js?v=15` even though `js/db.js` changed in this PR.

Proposed state: Treat only an explicit `false` reload result as failure, re-render the RSVP panel after a successful reload, and bump the `db.js` cache-bust query in `game-day.html`.

Blast radius: Limited to the Game Day RSVP control flow and cache invalidation for `game-day.html`.
