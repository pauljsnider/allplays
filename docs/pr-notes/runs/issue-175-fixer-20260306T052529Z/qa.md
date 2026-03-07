Regression target:
- Resuming a tracked game must restore persisted `liveLineup` and must not overwrite it with empty arrays during init.

Primary test guardrail:
- Unit-test a pure lineup restore helper that accepts `liveLineup` plus roster and returns sanitized `onCourt` and `bench`.

Cases to cover:
- Restores valid saved `onCourt` and `bench`.
- Removes duplicates and non-roster IDs.
- Backfills missing players onto `bench`.
- Falls back to empty `onCourt` and full-roster `bench` when persisted lineup is absent or invalid.

Manual spot check after code change:
1. Start a game, put players on court, and confirm lineup renders in tracker.
2. Reload tracker and choose resume.
3. Confirm on-court lineup remains populated.
4. Confirm `live-game.html` still shows the same lineup after resume.

Residual risk:
- This unit coverage proves restore behavior, but not the full browser prompt/init sequence end-to-end.
