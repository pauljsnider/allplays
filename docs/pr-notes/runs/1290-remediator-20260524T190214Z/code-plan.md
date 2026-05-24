# Code Plan

## Source Change
- Update `dashboard.html` `requireSyncedAuth()` to defer cleanup when `checkAuth()` invokes the callback before returning `unsubscribe`.
- Add a `settled` guard to prevent duplicate auth emissions from resolving/rejecting or initializing dashboard state more than once.

## Test Change
- Update `tests/unit/dashboard-parent-membership-sync.test.js` to evaluate the inline helper with mocked `checkAuth()` callbacks for synchronous authenticated, synchronous unauthenticated, and duplicate emission cases.

## Commit Message
`Fix dashboard auth unsubscribe race`
