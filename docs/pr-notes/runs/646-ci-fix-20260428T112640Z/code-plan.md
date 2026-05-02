# Code Plan

1. Update `tests/smoke/admin-invite-redemption.spec.js` so `EDIT_TEAM_DB_STUB` exports `getUserProfile()`.
2. Keep the return minimal: the authenticated owner's email is enough for the page initialization path.
3. Run the targeted smoke spec and commit the scoped change plus role notes.
