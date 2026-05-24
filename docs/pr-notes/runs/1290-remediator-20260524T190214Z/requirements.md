# Requirements

## Acceptance Criteria
- Dashboard auth completes exactly once per page load for authenticated users.
- Logged-out users redirect to `login.html` exactly once.
- Parent-linked teams continue to load through the `checkAuth` path before team rendering.
- If `checkAuth` invokes its callback synchronously before returning the unsubscribe function, the listener is still cleaned up.
- Duplicate auth emissions after the first settlement do not trigger duplicate dashboard initialization.

## Non-Goals
- No global auth API changes.
- No role, Firestore rule, or dashboard layout changes.
