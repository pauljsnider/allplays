# Requirements Role Summary

## Objective
Prevent admin invite acceptance failures when `user.email` is available from auth but profile email has not been persisted yet.

## Current vs Proposed
- Current: admin invite acceptance on `accept-invite.html` reads email from `getUserProfile(userId)?.email` only.
- Proposed: pass authenticated email through invite processing and use it as fallback to profile email.

## Risk Surface
- Blast radius limited to admin invite acceptance path in `accept-invite.html`.
- No change to Firestore rules or invite schema.

## Acceptance Criteria
1. Admin invite acceptance succeeds for newly signed-in users whose profile email is missing.
2. Existing flows with profile email continue to work.
3. Parent invite path remains unchanged.

## Assumptions
- Auth user object typically includes `email` for invite recipients.
- `redeemAdminInviteAcceptance` continues enforcing missing-email validation.
