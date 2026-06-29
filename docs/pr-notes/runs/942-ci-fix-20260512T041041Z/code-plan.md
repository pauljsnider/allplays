# Code Plan

## Implementation Plan
- Edit `tests/unit/admin-invite-signup-cache-busting.test.js` only.
- Replace the stale `accept-invite.html` import expectation with the current import string that includes `redeemHouseholdInvite` and `./js/db.js?v=76`.
- Do not modify `accept-invite.html` or runtime modules.
