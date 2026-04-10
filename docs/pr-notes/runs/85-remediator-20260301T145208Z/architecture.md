# Architecture role notes
- Keep invite processing centralized in `processPendingAdminInvites`.
- Ensure code normalization yields `null` when absent; gate email sending on non-null code.
- In `edit-team.html` new-team submit path, clear pending invite queue only after processor resolves, preserving queue on failure for retry.
- Existing-user and fallback shareable links remain handled by `buildAdminInviteFollowUp` prompt.
