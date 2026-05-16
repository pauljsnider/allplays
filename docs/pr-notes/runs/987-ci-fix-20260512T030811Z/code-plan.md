# Code Plan

## Implementation Plan
- Update `accept-invite.html` to import `auth.js?v=15` and `db.js?v=31`.
- Update stale auth imports in `js/admin.js` and `js/utils.js` to `auth.js?v=15`.
- Avoid unrelated refactors or logic changes.
- Update `tests/unit/accept-invite-page.test.js` harness import replacement strings so page-module tests continue to strip the cache-busted imports after the version bump.
