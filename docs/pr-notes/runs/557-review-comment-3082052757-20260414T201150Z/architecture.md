## Current State

- `track.html` finishes a game by building `aggregatedStats` inline:
  - configured columns are lowercased,
  - source stat keys are matched case-insensitively,
  - missing configured stats default to `0`,
  - non-config stats are preserved if they do not collide with the normalized configured key.
- `test-track-zero-stat-player-history.js` currently reimplements that same normalization block in its own helper.
- That duplication is what let the original case-sensitivity bug exist in both places at once. The test looked realistic, but it was not truly anchored to the production path.

## Proposed State

- Extract the normalization block from `track.html` into one tiny pure helper, for example `js/normalize-aggregated-stats.js`.
- Have `track.html` call that helper during finish-game batch creation.
- Update `test-track-zero-stat-player-history.js` to call the shared helper and keep its expectations explicit and literal:
  - zero-stat player gets `{ pts: 0, reb: 0, ast: 0 }`,
  - mixed-case input like `{ PTS: 8, ReB: 5, ast: 2 }` becomes `{ pts: 8, reb: 5, ast: 2 }`,
  - non-config keys like `blocks` remain preserved.
- Keep the Firestore write shape exactly as it is now. No schema or document-path changes.

## Architecture Decisions

- **Single source of truth for normalization:** the case-folding rules should live in one pure function, not in parallel copies.
- **Explicit contract in the test:** the test should still assert hard-coded expected objects, so it verifies behavior, not just “whatever the helper does.”
- **Minimal blast radius:** only the finish-game aggregated-stats assembly path and this regression test are touched.
- **Preserve current storage contract:** configured stat keys remain lowercase in saved `stats`, and unexpected extra keys remain supported.

## Risks

- **Small runtime risk:** moving inline code into a helper can introduce an import/wiring mistake in `track.html`.
- **Shared-helper tradeoff:** the test and runtime now share the same function, so the value of the test depends on keeping explicit expected outputs. Without those explicit assertions, the test would become too weak.
- **Blast radius:** limited to completed-game aggregated stat writes from `track.html`; no auth, rules, or unrelated tracker flows should move.

## Rollback

- Revert `track.html` to the current inline normalization block.
- Point `test-track-zero-stat-player-history.js` back to its local fixture/helper if needed.
- No data migration or cleanup is required, because this does not change stored schema, document IDs, or permissions.
