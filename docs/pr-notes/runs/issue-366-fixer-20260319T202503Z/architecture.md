Current state:
- Final-score reconciliation is implemented inline inside `saveAndComplete()` in `js/live-tracker.js`.
- The guard depends on `state.scoreLogIsComplete` and `canTrustScoreLogForFinalization(...)`.

Proposed state:
- Extract the final-score decision into `js/live-tracker-integrity.js` as a pure helper.
- Call the helper from `js/live-tracker.js` and the parallel basketball tracker path to keep one source of truth.

Why this shape:
- It reduces regression risk by centralizing the integrity rule.
- It gives unit tests direct access to the exact branch the finish flow relies on.

Blast radius:
- `js/live-tracker-integrity.js`
- `js/live-tracker.js`
- `js/track-basketball.js`
- tracker integrity unit tests

Rollback:
- Revert the helper call sites and the helper addition. No data migration or schema change is involved.
