# QA Role (allplays-qa-expert)

## Test Strategy
1. Add a unit regression test that inspects `js/db.js` for a team-scoped referenced-game guard before config deletion.
2. Add a unit regression test that inspects `edit-config.html` for delete-flow error handling and user messaging.
3. Run the focused vitest file first, then run the broader edit-config related unit tests.

## Regression Guardrails
- Keep assertions tied to the delete path only.
- Verify the UI still reloads configs after a successful delete.

## Manual Smoke (optional)
- In `edit-config.html`, try deleting a config that is assigned to a game and confirm the config remains visible with a clear alert.
- Delete an unused config and confirm it disappears normally.
