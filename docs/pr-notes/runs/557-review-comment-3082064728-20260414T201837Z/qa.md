## Test Focus

- **High: finish-flow write safety at Firestore limits**
  - Verify the finish action keeps **aggregatedStats** writes out of the primary batch.
  - Verify secondary aggregated-stats batches stay **well below 500 writes** (current cap in code is 450).
  - Verify the primary batch stays safe for realistic and boundary-sized game logs.

- **High: large game-log behavior**
  - Validate finish succeeds at the safe boundary (**499 event writes + 1 game update = 500 total writes**).
  - Validate behavior for **500+ logged events**. This is the biggest remaining risk, because the current remediation chunks roster writes but still leaves the primary event batch unchunked.

- **High: zero-stat player history preservation**
  - Every rostered player must receive an `aggregatedStats/{playerId}` doc, even with no recorded events.
  - Configured stat columns should persist as explicit zeroes.
  - Mixed-case keys should normalize correctly, and non-config stat keys should not be dropped.

- **Medium: finish-flow integrity and partial-write safety**
  - If finish fails, verify the game is not left in a misleading partial state, especially because aggregated-stats batches commit before the primary batch.
  - Confirm no orphaned zero-stat history is written without the game actually being marked completed.

- **Coverage gap to call out**
  - Repo checks currently cover:
    - aggregated-stats batching split
    - zero-stat player history generation
  - Repo checks do **not** currently cover:
    - **499 / 500 / 501 event** finish boundaries
    - partial-commit behavior when the primary batch fails

## Regression Risks

- **High:** Games with very large logs can still exceed Firestore’s 500-write limit in the **primary** batch.
- **High:** Partial persistence risk, where `aggregatedStats` commits succeed but `events` + final game update fail, leaving inconsistent post-game data.
- **High:** Zero-stat bench or inactive players disappearing from post-game history if roster-wide writes regress.
- **Medium:** Mixed-case stat keys creating duplicate or malformed stats (`PTS` vs `pts`) in saved history.
- **Medium:** Unexpected/custom stat keys being lost during normalization.
- **Medium:** Coach/admin sees a completed game summary, but parent/player-facing history omits zero-stat players or shows stale totals.

## Validation Matrix

| Priority | Scenario | Acceptance criterion | Method |
|---|---|---|---|
| High | Normal finish, small log, mixed roster usage | Finish succeeds, game status becomes `completed`, all game-log events persist, all rostered players get `aggregatedStats` docs | Manual + Firestore inspection |
| High | Boundary case: **499** logged events | Finish succeeds with no Firestore batch-limit error; primary write count stays at 500 including final game update | Add targeted automated check or scripted/manual data setup |
| High | Over-limit case: **500+** logged events | System must **either** chunk events **or** fail cleanly before partial persistence. No orphaned `aggregatedStats` docs, no false completed state | Manual negative test, Firestore inspection |
| High | Large roster / large aggregated stats payload | Aggregated-stats writes are split into batches of **<= 450**; no secondary batch exceeds Firestore limit | Existing `test-track-finish-batch-limit.js` plus boundary extension |
| High | Zero-stat rostered player | Player with no events still gets persisted stats doc with configured stat keys set to `0` | Existing `test-track-zero-stat-player-history.js` + manual verification |
| Medium | Mixed-case stat input | Persisted stats normalize correctly without duplicate-case keys and without value loss | Existing automated test |
| Medium | Extra non-config stats present | Non-config stat keys are preserved in saved history | Existing automated test |
| Medium | Post-finish reload | Reloaded completed game shows final score, event history, and zero-stat players still present in post-game stats/history views | Manual UI verification |
| Medium | Retry / interrupted finish | Re-click, refresh, or transient error does not create duplicated or inconsistent persisted finish data | Manual negative test |

## Manual Checks

1. **Baseline small game**
   - Track a game with a few events and at least one rostered player who records no stats.
   - Finish the game.
   - Verify in Firestore:
     - `games/{gameId}.status == "completed"`
     - `events` count matches logged events
     - every rostered player has an `aggregatedStats/{playerId}` doc
     - zero-stat player doc contains configured stats with zero values

2. **Boundary finish at 499 events**
   - Seed or simulate a game log with exactly 499 entries.
   - Finish the game.
   - Verify no console/Firebase batch-limit error and all expected writes land.

3. **Negative test at 500+ events**
   - Seed or simulate 500 and then 501 log entries.
   - Finish the game.
   - Verify the app does not silently corrupt state.
   - Specifically inspect for:
     - aggregated stats written without game completion
     - missing final game update
     - partial event persistence

4. **Large-roster coverage**
   - Use a roster large enough to force multiple aggregated-stats batches in synthetic/scripted testing.
   - Confirm no secondary batch exceeds 450 writes.

5. **History visibility check**
   - After finish, reload the game and any downstream stat/history view used by coaches/parents.
   - Confirm zero-stat players still appear in persisted history, not just in the live tracker state.

6. **Stat-shape regression check**
   - Use mixed-case stat keys and one unexpected stat key.
   - Confirm saved data is normalized and preserved correctly.

## Exit Criteria

- Existing repo checks pass:
  - `test-track-finish-batch-limit.js`
  - `test-track-zero-stat-player-history.js`
- Boundary validation exists for **499 / 500 / 501** event finishes, with evidence.
- No finish path can exceed Firestore’s 500-write limit without a clean, user-safe outcome.
- No partial-write state is observed when finish fails.
- Every rostered player, including zero-stat players, has persisted post-game history after finish and reload.
- Coach/admin and downstream history views reflect the same saved outcome.
- If 500+ event logs are not yet safely handled, treat that as a **release blocker or explicitly accepted known risk**, not a silent pass.
