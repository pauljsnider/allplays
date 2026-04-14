## Test Focus

- Verified regression coverage for the three scoped acceptance criteria in `/tmp/allplays-pr557/test-track-zero-stat-player-history.js`:
  1. **Mixed-case configured stats normalize correctly** (`PTS`, `ReB`, `ast` → `pts`, `reb`, `ast`)
  2. **Zero-stat rostered players still get aggregated stats docs**
  3. **Non-config stat keys remain preserved**
- Confirmed `track.html` uses the same lowercasing + fallback-preservation behavior in the finish-game aggregated stats write path.
- Executed:
  - `node /tmp/allplays-pr557/test-track-zero-stat-player-history.js`
  - Result: **4/4 tests passed**

## Regression Risks

- **Medium:** The standalone test now covers the mixed-case regression Amazon Q flagged, so the original blind spot is closed.
- **Medium:** The test helper still **mirrors production logic** instead of invoking `track.html` behavior directly. If both implementations drift together in a future edit, this test can still false-pass.
- **Low:** Zero-stat roster persistence is well represented because the test asserts one write per rostered player and zero-filled configured stats for scoreless players.
- **Low:** Non-config stat preservation is explicitly asserted and protected against accidental pruning.
- **Coverage gap:** No browser/manual automation currently validates the real finish flow from UI state through Firestore write payload assembly.

## Validation Matrix

| Acceptance criterion | Evidence | Result |
|---|---|---|
| Mixed-case configured stats should retain values and normalize to configured lowercase keys | `mixed-case configured stat keys are normalized without losing values` test; `track.html` now builds `playerStatsByLowerKey` before writing configured columns | Pass |
| Rostered players with no recorded stats should still persist with zeroed configured stats | `writes one aggregated stats doc per rostered player` and `zero-stat players get zeroed configured stats` tests | Pass |
| Existing non-config stats should not be dropped during save | `existing non-config stat keys are preserved` test; `track.html` preserves keys not already represented by configured lowercase keys | Pass |
| Regression test should specifically catch the prior case-sensitivity bug | New mixed-case test would fail against the old `Number(playerStats[key]) || 0` behavior | Pass |
| Real UI finish flow should be proven end-to-end | No direct automated/browser coverage in this PR | Gap |

## Manual Checks

1. Serve repo locally (`python3 -m http.server 8000`) and open a game in `track.html`.
2. Use a stat config whose columns are uppercase or mixed-case (`PTS`, `REB`, `AST`).
3. Record stats in a way that leaves in-memory/player payload keys mixed-case, then finish the game.
4. Inspect saved `aggregatedStats/{playerId}` docs and confirm:
   - configured stats are stored once, in lowercase
   - values are preserved, not zeroed by case mismatch
   - rostered players with no actions still get docs with zeroed configured stats
   - non-config keys such as `blocks` remain present
5. Re-open the completed game/history view and confirm zero-stat players still appear in saved player history.

## Exit Criteria

- ✅ Scoped regression test updated to cover the mixed-case bug Amazon Q identified
- ✅ Automated script passes for all three requested behaviors
- ✅ Production `track.html` write path matches the intended normalization/preservation logic
- ⚠️ Recommended before merge: one manual finish-flow check, because current automation is a mirrored unit script, not an end-to-end tracker save test
