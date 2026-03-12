Current state: `edit-team.html` delegates existing-team invites to `js/edit-team-admin-invites.js`, where `inviteExistingTeamAdmin()` normalizes the email, calls `inviteAdmin()`, then unconditionally persists `adminEmails`.

Proposed state:
- Parse the invite result once.
- If `existingUser` is true, persist access and return.
- If no valid code is present, return fallback metadata without persisting access.
- If a valid code exists, persist access before attempting email delivery so invite creation gates access while preserving the current "email failure still leaves a usable code" behavior.

Blast radius:
- Limited to the existing-team admin invite flow. New-team pending invite processing remains unchanged because it does not call `addTeamAdminEmail()`.
