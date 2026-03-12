# Requirements

Objective: restore the Stats config workflow for platform admins on `edit-config.html`.

Current state: team navigation exposes the Stats action to full-access users, including platform admins.
Proposed state: `edit-config.html` must evaluate access with the same shared team-access policy used by the rest of team management.

Risk surface: low. This touches a single page's client-side authorization gate and related unit coverage.
Blast radius: limited to team stats config entry and redirect behavior.

Assumptions:
- Platform admins are identified by `user.isAdmin === true`.
- Stats config management remains full-access only; parent access should still be denied.

Recommendation: centralize the page-level allow/deny decision behind a small helper and cover platform-admin, parent, and missing-team paths with Vitest.
