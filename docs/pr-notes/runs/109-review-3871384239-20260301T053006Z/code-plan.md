# Code Role Plan

## Minimal Patch
1. Add Auth cleanup in `signup()` parent-invite catch:
   - delete created auth user
   - sign out auth session
   - log cleanup failure and still sign out
   - rethrow original error
2. Update `tests/unit/auth-signup-parent-invite.test.js` to assert cleanup statements exist.

## Why This Path
Smallest safe delta that addresses review blocker and aligns with existing Google cleanup pattern.
