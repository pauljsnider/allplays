## Minimal Patch Plan

1. Keep the finish flow in `track.html` split into two write phases instead of one oversized Firestore batch.
2. Build `aggregatedStatsWrites` in memory first, but do not add those writes to the same batch as game-log events.
3. Keep the primary batch limited to:
   - all `events/*` writes
   - the final `games/{gameId}` update
4. Commit the primary batch first, then commit `aggregatedStats/*` writes in sequential secondary batches capped below Firestore’s 500-write limit, for example `450` per batch.
5. Add a focused regression script that asserts:
   - roster-wide aggregated stats are excluded from the primary batch
   - secondary aggregated-stats batches are chunked under the configured cap

## Concrete Changes

- In `track.html` around the finish-game submit handler (`~1229-1300`):
  - replace the single `batch` flow with:
    - `const primaryBatch = writeBatch(db);`
    - `const aggregatedStatsWrites = players.map(...)`
  - keep existing normalized stats generation unchanged
  - write game-log entries to `primaryBatch`
  - write the final game document update to `primaryBatch`
  - chunk `aggregatedStatsWrites` into `writeBatch(db)` calls using `MAX_AGGREGATED_STATS_BATCH_WRITES = 450`
  - `await primaryBatch.commit();` before the secondary stats batches, to preserve the old “finish game” success path as much as possible
- Add `test-track-finish-batch-limit.js` with math-only regression coverage for:
  - `490 events + 25 players => primary batch stays at 491 writes, stats go to a separate batch`
  - `905 aggregated stats writes => [450, 450, 5]`

## Validation Commands

```bash
cd /tmp/allplays-pr557
node test-track-finish-batch-limit.js
```

```bash
cd /tmp/allplays-pr557
python3 -m http.server 8000
```

Manual check after starting the server:
1. Open `http://127.0.0.1:8000/track.html#teamId=<teamId>&gameId=<gameId>`
2. Use a game with a large event log plus normal roster size
3. Finish the game
4. Confirm there is no Firestore 500-write batch failure and the game redirects successfully

## Notes

- I ran `node test-track-finish-batch-limit.js` in `/tmp/allplays-pr557`, and it passed.
- The current split-batch approach addresses the regression Codex flagged.
- Residual risk: if `gameState.gameLog.length + 1 > 500`, the primary batch can still overflow. That appears to be a pre-existing limit, not the new regression. Fixing that would require a broader batching redesign beyond this minimal patch.
