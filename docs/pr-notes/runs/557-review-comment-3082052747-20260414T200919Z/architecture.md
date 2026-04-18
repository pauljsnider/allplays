## Current State

- `track.html` saves final `aggregatedStats` for every rostered player when the game is finished.
- The buggy pattern was `normalizedStats[key] = Number(playerStats[key]) || 0`, where `key` is the lowercased configured column. That drops values when `playerStats` contains mixed-case keys like `PTS` or `ReB`.
- The in-flight fix changes that save path to first build a lowercase shadow map, then resolve configured columns from that map, while still preserving non-config stats.
- `test-track-zero-stat-player-history.js` now covers:
  - one write per rostered player,
  - zero-stat players getting zeroed configured columns,
  - mixed-case configured keys surviving normalization,
  - non-config keys being preserved.
- The test passes as written.

## Proposed State

- Keep the fix narrowly scoped to the final serialization boundary in `track.html`.
- Canonicalize configured stat columns through a lowercase lookup map derived from `playerStats`.
- Continue writing configured stats out in lowercase canonical form.
- Preserve extra, non-config stat keys only if their lowercase equivalent was not already emitted.
- Keep the regression test in `test-track-zero-stat-player-history.js` as the contract for this behavior.

## Architecture Decisions

- **Safest implementation pattern:** normalize at the persistence boundary, not by refactoring all in-memory tracker state.
- **Blast radius:** limited to:
  - `track.html` finish-game aggregated stats write path,
  - `test-track-zero-stat-player-history.js` parity/regression coverage.
- **Why this is safest:** no schema change, no Firebase rule change, no routing/UI flow change, no broader tracker behavior change during live entry.
- **Canonical form:** configured columns should remain lowercase in stored `aggregatedStats.stats`, which matches existing downstream expectations in this file.

## Risks

- If `playerStats` somehow contains both `PTS` and `pts` with different values, the lowercase shadow map collapses them, effectively last-write-wins. That is acceptable for a minimal fix, but it is still a collision policy.
- This does not migrate already completed historical docs that were previously saved with mixed-case-only configured keys.
- Read-time display code in `track.html` still prefers lowercase keys, so historical mixed-case docs may still render as zero until re-saved. That is outside this PR’s scoped fix but worth noting.

## Rollback

- Roll back by reverting only the `track.html` serialization hunk and the matching test additions in `test-track-zero-stat-player-history.js`.
- No data/schema rollback is required.
- Any docs already written in lowercase canonical form are forward-compatible, so reverting code does not require cleanup of saved data.
- Operationally, this is a low-risk static-page redeploy rollback.
