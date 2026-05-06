# Requirements

Subagent note: role-specific sessions_spawn was unavailable in this environment, so this is the inline requirements analysis required by the orchestration playbook.

## Acceptance Criteria
- Registration review filtering handles `registration-approved`, `roster-approved`, `rejected`, normalized statuses, and `all` without falling through incorrectly.
- Rejected filtering includes explicit `registrationApproved === false` or `rosterApproved === false` records.
- Roster approval audit metadata distinguishes a selected existing player from a newly generated player id.
- Team-admin registration approval must not batch writes to `/users/{guardianId}` that Firestore rules deny.
- Registration document update and delete access remains limited to team owner/admin/global-admin scope, not any signed-in user.

## Assumptions
- Parent user profile denormalization cannot be safely written from client team-admin context without broadening `/users` rules.
- The event null-check review item references stale or unavailable code in this checkout; no matching `getEvent(eventId)` or `event.id` approval path exists in the reviewed files.
