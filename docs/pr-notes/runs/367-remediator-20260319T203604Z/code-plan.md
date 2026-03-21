Implementation plan:
1. Bump the `live-tracker-integrity.js` cache token in `js/live-tracker.js`.
2. Bump the same token in `js/track-basketball.js`.
3. Re-run a targeted search to verify there are no stale `?v=1` imports remaining.
4. Stage and commit only the scoped remediation plus required role notes.
