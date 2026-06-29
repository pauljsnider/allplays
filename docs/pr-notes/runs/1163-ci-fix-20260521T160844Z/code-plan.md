# Code Plan

## Root Cause
- The PR modifies `js/db.js`, but the diff did not include any `db.js?v=<number>` import version change.
- The cache-bust guard blocks this to prevent stale browser module caches after deploy.

## Implementation Plan
- Update one existing `./js/db.js?v=76` import in `team.html` to `./js/db.js?v=76`.
- Re-run the guard locally.
