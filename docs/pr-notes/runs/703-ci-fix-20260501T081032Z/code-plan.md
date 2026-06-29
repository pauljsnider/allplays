# Code plan

## Root Cause
- PR #703 modifies `js/db.js`, which is on the critical cache-bust guard list.
- The branch did not include a matching changed import reference to `db.js?v=<number>`, so `scripts/check-critical-cache-bust.mjs` failed.

## Implementation Plan
- Update only `parent-dashboard.html` to bump its existing `./js/db.js?v=76` import to `./js/db.js?v=76`.
- Do not change application logic or unrelated imports.
