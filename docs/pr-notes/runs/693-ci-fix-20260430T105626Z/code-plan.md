# Code Plan

## Root Cause
- `js/db.js` changed in the PR, but the diff did not include any matching `db.js?v=<n>` import version bump. The cache-bust guard blocks this to prevent browsers from serving stale static ES module imports.

## Implementation Plan
- Update `player.html` and `team.html` imports from `./js/db.js?v=15` to `./js/db.js?v=16`.
- Do not modify behavior or unrelated imports.
- Validate with the cache-bust guard and commit using the required message format.
