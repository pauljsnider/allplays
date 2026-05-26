# Requirements

Acceptance criteria:
- Clicking "I've verified, continue" refreshes provider/auth state before deciding navigation.
- The continue decision uses the post-refresh app auth user state, not stale pre-refresh reloadCurrentUser output.
- If refreshed user has emailVerified true, route to the correct dashboard via getRouteForUser(refreshedUser).
- If refreshed user remains unverified or unavailable, stay on /verify-pending and show the existing guidance and secondary options.
- Do not redesign UI, resend flow, role routing, or Firebase verification mechanics.
