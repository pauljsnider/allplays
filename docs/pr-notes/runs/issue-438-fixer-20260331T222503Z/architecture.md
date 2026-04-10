Current state:
- The schedule editor duplicates season-record metadata rules inline when loading DB events, populating the edit form, and building submit payloads.
- `team.html` relies on saved game data and `js/season-record.js` for record display.

Proposed state:
- Introduce a focused helper module that owns season-record metadata normalization for schedule games.
- Reuse that helper in `edit-schedule.html` for:
- DB event normalization into schedule cache
- Edit form hydration
- Submit payload construction

Blast radius:
- Limited to schedule game metadata handling.
- No Firebase schema changes.
- No team page behavior changes beyond consuming the same persisted fields with lower drift risk.

Controls:
- Existing field names and default values remain unchanged.
- Vitest regression tests cover both create and edit flows tied back to `calculateSeasonRecord`.

Rollback:
- Revert the helper import and inline the prior logic.
