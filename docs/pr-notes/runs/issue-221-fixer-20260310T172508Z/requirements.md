Objective: ensure accepted admin invites produce immediately usable team-management access.

Current state:
- Admin invite redemption persists team access through `team.adminEmails`.
- Dashboard discovery and team-management guards still depend on the runtime user email being populated on the current auth object.
- If the auth object lacks a usable email during the redirect/load path, the newly accepted admin is stranded even though the team document is correct.

Proposed state:
- Discovery and authorization should use the persisted profile email as a fallback when the auth object email is missing.

Risk surface and blast radius:
- Affects dashboard team discovery and team-management access checks.
- No schema change.
- Low blast radius because owner and platform-admin paths remain unchanged.

Assumptions:
- Accepted admin invites persist or can recover the user email on the profile.
- Existing authorization should remain owner/admin-email/platform-admin only.

Recommendation:
- Add a regression for profile-email fallback.
- Apply the fallback in shared access evaluation and dashboard discovery.

Success measure:
- A user with matching `profile.email` and missing auth email can discover the team on `dashboard.html` and pass `hasFullTeamAccess(...)`.
