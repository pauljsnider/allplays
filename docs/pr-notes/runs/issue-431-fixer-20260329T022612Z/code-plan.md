# Code Role Synthesis

## Planned Changes
1. Add `tests/unit/game-day-rsvp-controls.test.js` for panel moves, counts, and visible save status.
2. Add `tests/unit/game-day-rsvp-breakdown.test.js` for persisted last-write-wins grouping.
3. Add `js/game-day-rsvp-controls.js` for render + submit behavior used by `game-day.html`.
4. Add `js/game-day-rsvp-breakdown.js` for pure grouped breakdown calculation used by `js/db.js`.
5. Update `game-day.html` to import and use the RSVP controls helper.
6. Update `js/db.js` to delegate grouped breakdown calculation to the pure helper.

## Minimal Fix
- After RSVP save and panel reload, set the status on the current DOM node, not the detached pre-render node.
