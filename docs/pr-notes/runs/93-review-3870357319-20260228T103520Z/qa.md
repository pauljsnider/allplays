# QA Role Notes

## Test Strategy
- Verify query argument wiring for both replay and non-replay modes.
- Run lightweight static validation for syntax safety.

## Regression Checks
- Non-replay: inactive players should remain hidden in lineup/stat contexts.
- Replay: inactive players available for historical rendering.

## Manual Verification Matrix
1. Open `live-game.html?teamId=<id>&gameId=<id>` and confirm only active players appear.
2. Open `live-game.html?teamId=<id>&gameId=<id>&replay=true` and confirm inactive players are present for historical stats.
3. Confirm no load errors in console during initialization.

## Residual Risk
If completed-game workflows rely on inactive players without `replay=true`, those sessions may still hide inactive records. Current scope follows review feedback precisely.
