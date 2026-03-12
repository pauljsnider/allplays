Risk to cover:
- A malformed invite result or missing code should not grant team admin access.
- Successful invite creation with a code should still persist access before email delivery.
- Existing-user invites should still persist access and skip email delivery.

Validation plan:
- Update `tests/unit/edit-team-admin-invites.test.js` with a regression that `addTeamAdminEmail()` is not called when `inviteAdmin()` returns `null` or whitespace-only `code`.
- Re-run the focused Vitest file for admin invite helper behavior.
