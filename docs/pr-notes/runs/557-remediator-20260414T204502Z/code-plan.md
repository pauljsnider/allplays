Patch Plan
1. Extract tracker stat normalization into a helper in `track.html` so the case-insensitive behavior is explicit and reused at the write site.
2. Commit the primary finish batch before chunked aggregated-stats batches.
3. Mirror the normalization helper in `test-track-zero-stat-player-history.js` and add the exact uppercase-key regression case from review.

Code Changes Applied
- Planned before implementation; update after edits:
  - `track.html`: helper extraction, primary-batch-first finish ordering.
  - `test-track-zero-stat-player-history.js`: helper extraction, uppercase-key regression test.

Validation Run
- `node test-track-zero-stat-player-history.js`

Residual Risks
- Finish still cannot be fully atomic across more than 500 writes; preserving primary game completion data first is the chosen tradeoff.
- Browser-only manual verification is still needed for full end-to-end tracker confidence.

Commit Message Draft
- Harden tracker stat normalization and finish batching