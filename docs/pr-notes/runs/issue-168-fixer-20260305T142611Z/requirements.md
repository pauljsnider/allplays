# Requirements Role Synthesis (Fallback)

Objective: Prevent broken edit mode when `edit-team.html` is opened with an invalid or inactive `teamId`.

Current behavior:
- Page switches to edit mode and leaves form interactive before confirming team existence.
- Missing/inactive team results in blank form and save attempts `updateTeam` with invalid target.

Expected behavior:
- If `teamId` is present but `getTeam(teamId)` returns `null`, the page must:
  1. Show a clear error to user.
  2. Redirect to a safe destination (`dashboard.html`).
  3. Avoid entering a broken edit submit path.

Acceptance criteria:
- Invalid/inactive team id does not allow successful submission path toward `updateTeam`.
- User receives explicit feedback (alert text).
- Existing valid edit flow remains unchanged.
- Create-team flow (no `teamId`) remains unchanged.

Risk surface / blast radius:
- Limited to `edit-team.html` load behavior for invalid/inactive team IDs.
- No backend schema/rules changes.

Assumptions:
- Redirect target should remain dashboard based on existing access-denied handling.
- Alert-based messaging is acceptable in current UX pattern.
