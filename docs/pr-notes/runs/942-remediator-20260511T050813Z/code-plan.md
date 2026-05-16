# Code plan

- In `js/db.js`, add small helpers for email matching, user/player/membership rollback, and code reset.
- Move household invite post-claim validation into the try/catch so failure triggers rollback.
- Capture membership pre-update state before changing family membership and restore it on failure.
- In `js/accept-invite-flow.js`, wrap `redeemHouseholdInvite` in try/catch and map low-level errors to user-friendly messages.
