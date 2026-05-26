# Architecture

Decision:
- Keep reloadCurrentUser as a provider/session refresh trigger.
- Make auth.refresh return the hydrated AuthUser so the page does not rely on React state propagation timing.
- VerifyPending branches and routes using the returned refreshed user.

Risk notes:
- No data model or access-control changes.
- Reduces stale native REST fallback state risk.
- If refresh returns null or fails, existing blocked/error behavior remains.
