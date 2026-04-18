## Test Focus
- **Mixed-case configured stat-key normalization, high risk**: Verify `track.html` saves configured columns by lowercased canonical keys while retaining values entered under mixed-case source keys like `PTS`, `ReB`, and `ast`.
- **Zero-stat roster persistence, high risk**: Verify every rostered player still gets an `aggregatedStats/{playerId}` document with zeroed configured stats when they finish with no logged events.
- **Non-config stat preservation, medium risk**: Verify existing in-memory stats outside `currentConfig.columns` remain in the saved `stats` object and are not dropped during finish-game normalization.
- **Regression surface, medium risk**: Confirm finish flow still writes one doc per rostered player, preserves player metadata, and does not introduce duplicate case variants for configured stats.

## Regression Risks
- **High**: Mixed-case stat input could be saved as `0` if lookup normalization and configured-column matching diverge.
- **High**: Bench or zero-stat players could disappear from historical views if finish flow skips players without tracked events.
- **Medium**: Custom or legacy stat keys not present in current config could be silently removed from player history.
- **Medium**: Configured stats could be duplicated across `PTS` and `pts`, causing downstream summaries or history pages to read inconsistent values.
- **Low**: Player name/number metadata could drift if aggregated writes no longer map one-to-one with roster players.

## Validation Matrix
| Area | Scenario | Expected Result | Coverage |
|---|---|---|---|
| Mixed-case normalization | `playerStats` contains `{ PTS: 8, ReB: 5, ast: 2 }` with config `['PTS','REB','AST']` | Saved stats are exactly `{ pts: 8, reb: 5, ast: 2 }` with no duplicate mixed-case configured keys | **Automated**: `mixed-case configured stat keys are normalized without losing values` |
| Zero-stat roster persistence | One player has stats, second player has none | Finish flow writes two `aggregatedStats` docs, including zeroed configured stats for the scoreless player | **Automated**: `writes one aggregated stats doc per rostered player`, `zero-stat players get zeroed configured stats` |
| Non-config stat preservation | `playerStats` contains configured keys plus `blocks: 3` while config omits `BLOCKS` | Saved stats keep `{ pts, reb, blocks }`; non-config key is preserved | **Automated**: `existing non-config stat keys are preserved` |
| Duplicate-key avoidance | Source contains mixed-case configured keys only | Saved object contains lowercase configured keys only, not both `PTS` and `pts` | **Automated**, implied by mixed-case normalization assertion |
| Finish-flow integrity | Submit finish form after tracking or with zero-stat roster players | Batch write succeeds, game status completes, opponent stats still persist on game doc | **Manual** |
| History/readback confidence | Reopen saved game or inspect Firestore `aggregatedStats` docs | Stored stats reflect normalized configured keys, zero-stat players exist, non-config keys remain readable | **Manual** |

## Manual Checks
1. Serve `/tmp/allplays-pr557` locally and open `track.html` with a game using a config that includes mixed-case display labels like `PTS`, `REB`, `AST`.
2. Track stats for one player, leave another rostered player at zero, finish the game, and inspect Firestore `aggregatedStats`:
   - every rostered player has a doc,
   - zero-stat player doc exists,
   - configured keys are lowercase,
   - values match what was entered.
3. Seed or simulate a player stats object containing a non-config key such as `blocks`, finish the game, and confirm the saved `stats` object still includes `blocks`.
4. Confirm no configured stat is duplicated under both mixed-case and lowercase keys after save.
5. Reopen any player-history or game-summary surface that reads `aggregatedStats` and confirm zero-stat players and normalized stats render without blanks or regressions.

## Exit Criteria
- Automated check `node test-track-zero-stat-player-history.js` passes all four assertions.
- Firestore/manual verification confirms one `aggregatedStats` doc per rostered player, including zero-stat players.
- Mixed-case configured keys save to lowercase canonical keys with correct non-zero values.
- Non-config stat keys remain present after finish-game save.
- No duplicate configured stat keys or finish-flow regressions are observed in manual validation.
