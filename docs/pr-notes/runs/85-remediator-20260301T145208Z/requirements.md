# Requirements role notes
- Objective: resolve PR #85 unresolved feedback threads only.
- Required behaviors:
  - Do not call `sendInviteEmail` when invite code is missing/null.
  - Clear `pendingAdminInviteEmails` after successful processing in new-team flow to avoid duplicate invites on repeated submit.
  - Surface existing-user invite codes/links after new team creation so invite redemption can complete.
- Scope: `js/edit-team-admin-invites.js`, `edit-team.html`.
