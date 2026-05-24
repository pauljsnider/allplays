# Requirements

## Acceptance Criteria
- `requireSyncedAuth()` must resolve or reject exactly once for the first auth emission.
- The auth subscription returned by `checkAuth()` must be unsubscribed even when `checkAuth()` invokes its callback synchronously before returning the unsubscribe function.
- Unauthenticated users must still redirect to `login.html` and reject with `Not authenticated`.
- Regression coverage must prove synchronous user, synchronous no-user, and duplicate callback paths do not leak or double-settle.

## Scope
- Keep the remediation limited to `dashboard.html` auth synchronization and its unit regression coverage.
