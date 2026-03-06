# QA Role Notes (fallback)

## Regression Risks
- Reintroducing hard-delete in `deletePlayer`.
- Historical pages dropping player names for deactivated users.
- Accidentally exposing inactive players in active roster workflows.

## Test Strategy
- Add unit regression test asserting `deletePlayer` implementation uses soft-delete update fields and does not call `deleteDoc` in function body.
- Add unit test assertions that historical pages use `includeInactive: true` in `getPlayers` calls.
- Run full `tests/unit` suite.

## Manual Spot Checks
- Deactivate player from roster UI and verify old game report + player deep link still load.
