# Architecture Role (manual fallback)

## Current state
`signup()` catches parent-invite finalize errors and suppresses profile-stage failures, allowing overall signup success.

## Proposed state
Treat parent-invite finalization as atomic from caller perspective: if any stage fails, throw error from `signup()` so caller/UI handles as signup failure.

## Risk surface / blast radius
- Touches auth flow for email/password parent-invite signups.
- Main regression risk: over-failing non-parent-invite signups or redeem-stage cleanup.
- Mitigation: targeted unit tests around parent-invite flow only.

## Controls
- Preserve existing rollback of invite linkage in `parent-invite-signup.js`.
- Preserve auth-user cleanup in `auth.js` catch blocks.
