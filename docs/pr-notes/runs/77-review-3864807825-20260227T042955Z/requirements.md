# Problem Statement
Admin invite acceptance currently performs three independent writes (team admin list, user coach roles, access-code consumption). Any mid-sequence failure can leave a coach partially configured, causing access inconsistencies in coach/admin workflows.

# User Segments Impacted
- Invited admin/coach: must receive complete coach permissions or no state change.
- Team owner/admin: must avoid inconsistent admin roster and support cleanup.
- Parents/players: indirect impact via reliable team-level permission enforcement.
- Program manager: needs lower operational toil from invite-recovery incidents.

# Acceptance Criteria
1. Redeeming an `admin_invite` persists team admin email, user coach role/team linkage, and code usage in one atomic persistence unit.
2. If any write in the admin-invite persistence unit fails, no partial invite acceptance state is committed.
3. Invite acceptance still returns team context for success UX messaging.
4. Existing parent invite redemption behavior remains unchanged.
5. Unit tests validate the atomic admin-invite contract and reject non-atomic wiring.

# Non-Goals
- Refactoring parent invite redemption in this change.
- Introducing backend Cloud Functions for invite redemption.
- Redesigning invite UX copy or redirect behavior.

# Edge Cases
- User email is mixed case or includes leading/trailing spaces.
- User already listed in `team.adminEmails`.
- User already has `coach` role and existing `coachOf` entries.
- Invite code has no `codeId` (legacy validation result shape).

# Open Questions
- Should `admin_invite` enforce one-time redemption with transactional precondition checks against already-used codes in the same unit (future hardening)?
