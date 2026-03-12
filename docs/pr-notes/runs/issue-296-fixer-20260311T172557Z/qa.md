Primary regression:
- Existing-team admin invite must persist access even if the owner never clicks Save Team afterward.

Focused tests:
- Unit test for new helper proving `addTeamAdminEmail` is called for an existing-team invite before email delivery.
- Unit test proving existing-account invites also persist `adminEmails`.
- Wiring guard confirming `edit-team.html` uses the helper and imports `addTeamAdminEmail`.

Manual validation target:
1. Invite an admin from `edit-team.html` on an existing team.
2. Leave without saving.
3. Sign in as the invited email and confirm dashboard/team-management access appears immediately.

Residual risk:
- Invite-send now grants team access entitlement immediately, before invite acceptance UI completes. That matches the app’s email-based authorization model but should be noted.
