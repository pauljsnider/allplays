Primary regressions to guard:
- Non-admin or parent viewers must not see editable stat controls.
- Existing completed-game report rendering must still work when `didNotPlay` is absent.
- Saving one player must not wipe unrelated stats or player identity fields.

Validation targets:
- Unit test the editor payload builder, especially `Did not play`.
- Unit test roster navigation semantics for previous/next save flows.
- Manual spot check: completed game page shows `Edit Stats` only for full-access users.

Manual checks:
- Open a completed game as a full-access user.
- Edit a player stat line and save.
- Mark another player `Did not play`, save and reload.
- Confirm the report table updates and DNP label persists.
