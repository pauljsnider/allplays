# Code role notes
Plan:
1. Update `js/edit-team-admin-invites.js` to normalize invite code as nullable and enforce explicit null check before `sendInviteEmail`.
2. Update `edit-team.html` new-team submit flow to clear `pendingAdminInviteEmails` immediately after successful `processPendingAdminInvites` call (not in `finally`).
3. Validate with focused grep/diff and run available targeted tests (if any automation exists; otherwise report manual-only).
4. Commit with review-remediation message.
