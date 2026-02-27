# Code Role Plan

## Patch Scope
1. `js/edit-team-admin-invites.js`
- Validate `inviteResult.code` as trimmed string before calling `sendInviteEmail`.
- If missing, classify as `fallback_code` and continue.

2. `edit-team.html`
- Bump import cache version for `edit-team-admin-invites.js`.
- Clear `pendingAdminInviteEmails` immediately after `processPendingAdminInvites` completes.

## Non-Goals
- No behavior changes to Firestore code generation.
- No UI redesign for invite banners.
