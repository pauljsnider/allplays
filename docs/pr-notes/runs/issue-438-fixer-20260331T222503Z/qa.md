Scope:
- Regression coverage for tournament/bracket games excluded from season record after save and reload.

Test strategy:
- Add one Vitest file that validates:
- Form-state to saved-game payload for a completed tournament game with unchecked record flag.
- Saved-game payload back to form-state on reload.
- `calculateSeasonRecord` still excludes the tournament game while counting same-season league games.

Why this approach:
- The repo currently uses Vitest for durable automation.
- This covers the highest-risk serialization and hydration seams without introducing a new browser test stack.

Pass criteria:
- New tests fail before helper implementation.
- Targeted unit suite passes after helper extraction and wiring.
- No unrelated test regressions in season-record or schedule-editor helpers.
