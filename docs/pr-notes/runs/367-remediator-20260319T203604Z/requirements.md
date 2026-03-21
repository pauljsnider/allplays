Objective: address PR thread PRRT_kwDOQe-T5851kfgX by preventing stale cached copies of `live-tracker-integrity.js` from breaking module linking after the new `resolveFinalScoreForCompletion` export was added.

Current state: `js/live-tracker.js` and `js/track-basketball.js` both import `./live-tracker-integrity.js?v=1`.
Proposed state: bump the import query token anywhere that helper is imported so returning browsers fetch the updated helper bundle.

Risk surface: limited to tracker module cache busting for basketball/live tracker pages.
Blast radius: low; only two import statements change and behavior is otherwise unchanged.

Assumptions:
- `?v=` query params are the repo's standard cache-busting mechanism.
- No other runtime imports of `live-tracker-integrity.js` exist beyond the two identified files.

Recommendation: update both imports to a new shared version token and manually verify the references.
