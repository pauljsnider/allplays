Objective: remediate four unresolved PR #247 review comments with the smallest code change.

Current state:
- `calendar.html` locates the RSVP child selector with `btn.closest('.mt-3')`, which couples behavior to a presentation class.
- `js/calendar-rsvp.js` reads `linkedPlayersByTeam.get(teamId)` twice and uses `players` where the reviewer requested a clearer intermediate name.

Proposed state:
- Mark the RSVP block with a semantic `data-rsvp-container` attribute and use that for selector scoping.
- Store the looked-up players array once, normalize it to `playerArray`, and map that variable for allowed IDs.

Risk surface and blast radius:
- Limited to parent RSVP selection/rendering on `calendar.html`.
- No data model or API changes.

Assumptions:
- The rendered RSVP block is the intended semantic container for child selector lookup.
- Existing RSVP behavior for single-child and no-child states must remain unchanged.

Recommendation:
- Apply only the requested selector and variable cleanup changes.

Success measure:
- All four review threads are addressed in code with no behavior change outside RSVP container lookup stability.
